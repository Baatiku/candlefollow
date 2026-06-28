import re

def check_balance(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()

    match = re.search(r'return\s*\(\s*(<div.*)\);\s*\}', text, re.DOTALL)
    if not match:
        print("No return block found")
        return
        
    jsx = match.group(1)
    
    # Simple brace counter to find unclosed {
    brace_depth = 0
    for i, char in enumerate(jsx):
        if char == '{':
            brace_depth += 1
        elif char == '}':
            brace_depth -= 1
            if brace_depth < 0:
                print(f"Extra closing brace at offset {i}")
                # print context
                print(jsx[max(0, i-50):min(len(jsx), i+50)])
                brace_depth = 0
                
    print(f"Final brace depth: {brace_depth}")
    
    # Count div tags
    div_open = len(re.findall(r'<div\b[^>]*>', jsx))
    div_close = len(re.findall(r'</div\s*>', jsx))
    print(f"div open: {div_open}, close: {div_close}, diff: {div_open - div_close}")

check_balance(r'c:\Users\Besta\iqoption\frontend\src\App.jsx')
