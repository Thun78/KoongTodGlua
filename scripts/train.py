import os
os.environ["HSA_OVERRIDE_GFX_VERSION"] = "9.4.2"

import torch
from unsloth import FastModel
from trl import SFTTrainer, SFTConfig
from datasets import load_dataset

def train():
    print("Initializing base model on AMD Instinct MI300X...")
    # Load Gemma 4 variant in 4-bit quantization to leave ample VRAM for context processing
    model, tokenizer = FastModel.from_pretrained(
        model_name="google/gemma-4-E4B-it",
        max_seq_length=1024,
        load_in_4bit=True
    )

    # Attach Parameter-Efficient Fine-Tuning (PEFT) LoRA adapters
    model = FastModel.get_peft_model(
        model,
        r=16,
        lora_alpha=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0,
        bias="none"
    )

    # Load ChatML dataset
    print("Loading unified match dataset...")
    dataset = load_dataset("json", data_files="unified_match_data.jsonl")["train"]

    # Configure training parameters optimized for MI300X compute
    training_args = SFTConfig(
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4, # Effective batch size = 16
        warmup_steps=20,
        max_steps=350, # Sufficient for convergence without scoreline memorization
        learning_rate=2e-4,
        fp16=False,
        bf16=True, # MI300X native high-speed Bfloat16 acceleration
        logging_steps=10,
        output_dir="checkpoints_gemma4_match",
        report_to="none",
        dataset_text_field="messages"
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=training_args,
    )

    print("Starting SFT training loop...")
    trainer.train()

    print("Training complete! Merging weights to 16-bit for vLLM compatibility...")
    # Export merged model so vLLM can serve it natively without dynamic LoRA overhead
    model.save_pretrained_merged("gemma-4-match-finetune", tokenizer, save_method="merged_16bit")
    print("Exported production-ready model to ./gemma-4-match-finetune")

if __name__ == "__main__":
    train()
