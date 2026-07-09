import os
os.environ["HSA_OVERRIDE_GFX_VERSION"] = "9.4.2"
import json
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

model_path = "./gemma-4-match-finetune"
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForCausalLM.from_pretrained(
    model_path, 
    torch_dtype=torch.bfloat16, 
    device_map="auto"
)

test_prompt = [
    {"role": "system", "content": "You are AdaptiveMatch AI, an intelligent UI curator. Select the most relevant statistics to display from the fixed vocabulary based on the live match state and user persona. Output strict JSON."},
    {"role": "user", "content": json.dumps({"persona": "Bettor", "match_state": {"minute": 82, "score": [3, 3], "foul_frequency": "Spiking"}})}
]

inputs = tokenizer.apply_chat_template(test_prompt, return_tensors="pt", add_generation_prompt=True).to("cuda")
outputs = model.generate(inputs, max_new_tokens=150, temperature=0.1)

response = tokenizer.decode(outputs[0][inputs.shape[-1]:], skip_special_tokens=True)
print("\n--- Model Output Validation ---")
print(response)
