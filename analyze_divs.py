import re

with open(r'c:\Users\Besta\iqoption\frontend\src\App.jsx', 'r', encoding='utf-8') as f:
    text = f.read()
    
main_return_match = re.search(r'return\s*\(\s*(<div.*)', text, re.DOTALL)
if not main_return_match:
    exit(1)
    
text = main_return_match.group(1)

stack = []
lines = text.split('\n')
for i, line in enumerate(lines):
    line_num = i + 1
    # Find all <div...> and </div>
    tokens = re.finditer(r'<(/)?div([^>]*)>', line)
    for t in tokens:
        is_closing = t.group(1) == '/'
        attrs = t.group(2)
        if not is_closing:
            class_match = re.search(r'className=["\']([^"\']+)["\']', attrs)
            cname = class_match.group(1) if class_match else ''
            stack.append((line_num, cname))
        else:
            if stack:
                stack.pop()
            else:
                print(f'Line {line_num}: Unmatched closing div')

print('Unclosed divs at end:')
for item in stack:
    print(f'Line {item[0]} class: {item[1]}')
