import docx
import glob
import os

def read_docx(file_path):
    doc = docx.Document(file_path)
    return '\n'.join([p.text for p in doc.paragraphs if p.text.strip()])

files = glob.glob('/Users/David/Documents/Mamba/docs/*.docx')
for f in files:
    print(f"--- {os.path.basename(f)} ---")
    text = read_docx(f)
    print(text[:500] + "\n... (truncated)\n")
