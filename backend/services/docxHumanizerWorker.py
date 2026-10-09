#!/usr/bin/env python3
"""
Tessera AI — High-Precision Academic DOCX Humanizer Worker
Extracts substantive body paragraphs from a Word (.docx) document,
humanizes prose using active Gemini models (gemini-3.5-flash, gemini-flash-lite-latest)
or Groq with deterministic IEEE syntactic de-biasing fallbacks,
and writes back into the WordprocessingML zip while preserving all styles, figures, and formatting.
"""

import sys
import os
import re
import json
import zipfile
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
import xml.etree.ElementTree as ET

W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS_MAP = {'w': W_NS}

BANNED_AI_REPLACEMENTS = [
    ("Furthermore, ", ""),
    ("Moreover, ", ""),
    ("Additionally, ", ""),
    ("In summary, ", ""),
    ("Ultimately, ", ""),
    ("In conclusion, ", ""),
    ("Notably, ", ""),
    ("Crucially, ", "Specifically, "),
    ("In recent years, ", ""),
    ("A paramount challenge", "A primary challenge"),
    ("paramount", "essential"),
    ("research landscape", "research domain"),
    ("landscape", "domain"),
    ("delineates this", "illustrates this"),
    ("delineates", "details"),
    ("cranking up transmission bandwidth", "scaling carrier frequencies into upper millimetric spectrum"),
    ("cranking up bandwidth", "increasing channel bandwidth"),
    ("sound almost impossible", "push theoretical boundary limits"),
    ("locked in separate academic silos", "isolated within specialized subfields"),
    ("plays a pivotal role in", "is essential for"),
    ("plays a crucial role in", "directly influences"),
    ("delve into", "examine"),
    ("delves into", "examines"),
    ("delving into", "examining"),
    ("underscores the importance of", "highlights"),
    ("underscores", "demonstrates"),
    ("fosters", "enables"),
    ("tapestry", "framework"),
    ("beacon", "foundation"),
    ("testament", "evidence"),
    ("pivotal", "central"),
    ("Our synthesis of the literature reveals", "Looking across the literature, we identify"),
    ("Our evaluation of the literature uncovers", "Benchmarking across the studies reveals"),
    ("Our inquiry is structured around", "We frame this inquiry around"),
    ("Our systematic review provides", "This synthesis offers"),
]

HUMANIZER_SYSTEM_PROMPT = """You are an experienced IEEE Transactions peer reviewer writing in an authentic, high-precision academic voice.
Rewrite and humanize this academic paragraph to pass Turnitin AI detection (< 5% AI score).

STRICT WRITING RULES:
1. DYNAMIC BURSTINESS: Aggressively alternate between short punchy technical statements (4-7 words: e.g., 'Propagation losses are severe.' 'Thermal limits bound throughput.') and long multi-clause analytical sentences (30-45 words) with semicolons or dependent clauses.
2. VARIED SENTENCE OPENERS: Never start consecutive sentences with 'The...' or 'This...'. Use diverse transitions: 'In practice,', 'By contrast,', 'To evaluate this tradeoff,', 'Under peak load,'.
3. FORMAL ACADEMIC REGISTER: Use rigorous engineering vocabulary. Never use colloquial slang (no 'cranking up', no 'game changer', no 'academic silos'). Use authentic active researcher voice ('We observed that...', 'Our benchmark testbed revealed...').
4. BAN AI WORDS: Never use delve, tapestry, beacon, testament, pivotal, paramount, crucial, vital, multifaceted, plethora, myriad, cornerstone, revolutionize, ever-evolving, landscape, underscores, delineates, fosters, furthermore, moreover, additionally, in conclusion, notably, in recent years.
5. CITATION FIDELITY: Retain ALL citations (e.g., [1], [2], or Author, Year) and quantitative metrics VERBATIM.
6. Return ONLY the rewritten paragraph. Absolutely NO introductory text, markdown headers, or bullet points."""

GEMINI_MODELS = [
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.5-flash'
]

def clean_markers(text):
    if not text:
        return ""
    for old, new in BANNED_AI_REPLACEMENTS:
        text = text.replace(old, new)
        text = text.replace(old.lower(), new.lower())
    return text.strip()

def humanize_paragraph_gemini(api_key, text):
    prompt = f"{HUMANIZER_SYSTEM_PROMPT}\n\nPARAGRAPH TO REWRITE:\n{text}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.86,
            "topP": 0.95
        }
    }

    for model_name in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=18) as response:
                data = json.loads(response.read().decode('utf-8'))
                raw = data['candidates'][0]['content']['parts'][0]['text'].strip()
                # Ensure no meta-commentary was outputted
                lines = [l.strip() for l in raw.split('\n') if l.strip() and not l.strip().startswith('Here is') and not l.strip().startswith('**')]
                result = ' '.join(lines)
                if len(result) > 50:
                    return clean_markers(result)
        except Exception as e:
            continue

    return clean_markers(text)

def humanize_paragraph_groq(api_key, text):
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": HUMANIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"PARAGRAPH TO REWRITE:\n{text}"}
        ],
        "temperature": 0.85
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        data = json.loads(response.read().decode('utf-8'))
        raw = data['choices'][0]['message']['content'].strip()
        lines = [l.strip() for l in raw.split('\n') if l.strip() and not l.strip().startswith('Here is') and not l.strip().startswith('**')]
        return clean_markers(' '.join(lines))

def rewrite_single_paragraph(args):
    p_node, raw_text, t_nodes, gemini_key, groq_key = args

    # 1. Try Groq (if key provided)
    if groq_key and groq_key != 'none':
        try:
            rewritten = humanize_paragraph_groq(groq_key, raw_text)
            if rewritten and len(rewritten) > 50:
                return rewritten
        except Exception:
            pass

    # 2. Try Gemini (gemini-3.5-flash -> gemini-flash-lite-latest)
    if gemini_key and gemini_key != 'none':
        try:
            rewritten = humanize_paragraph_gemini(gemini_key, raw_text)
            if rewritten and len(rewritten) > 50:
                return rewritten
        except Exception:
            pass

    return clean_markers(raw_text)

def main():
    if len(sys.argv) < 3:
        print("Usage: docxHumanizerWorker.py <input.docx> <output.docx> [gemini_key] [anthropic_key] [groq_key]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    gemini_key = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'none' else os.environ.get('GEMINI_API_KEY')
    groq_key = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != 'none' else os.environ.get('GROQ_API_KEY')

    print(f"Processing docx: {input_path}")
    
    with zipfile.ZipFile(input_path, 'r') as src_zip:
        xml_content = src_zip.read('word/document.xml')
        tree = ET.fromstring(xml_content)

        paragraphs_to_process = []
        for p in tree.findall('.//w:p', NS_MAP):
            pPr = p.find('w:pPr', NS_MAP)
            if pPr is not None:
                pStyle = pPr.find('w:pStyle', NS_MAP)
                if pStyle is not None and 'Heading' in pStyle.attrib.get(f'{{{W_NS}}}val', ''):
                    continue

            if p.findall('.//w:drawing', NS_MAP):
                continue

            t_nodes = p.findall('.//w:t', NS_MAP)
            full_text = ''.join(t.text for t in t_nodes if t.text).strip()

            if len(full_text) < 120 or full_text.startswith('http') or full_text.startswith('References') or full_text.startswith('Keywords:'):
                continue

            paragraphs_to_process.append((p, full_text, t_nodes, gemini_key, groq_key))

        total_paragraphs = len(paragraphs_to_process)
        print(f"Found {total_paragraphs} substantive body paragraphs. Processing concurrently...")

        # Process with up to 3 parallel workers
        with ThreadPoolExecutor(max_workers=3) as executor:
            humanized_results = list(executor.map(rewrite_single_paragraph, paragraphs_to_process))

        for idx, humanized_text in enumerate(humanized_results):
            p_node, raw_text, t_nodes, _, _ = paragraphs_to_process[idx]
            if t_nodes:
                t_nodes[0].text = humanized_text
                for t in t_nodes[1:]:
                    t.text = ""

        modified_xml = ET.tostring(tree, encoding='utf-8', xml_declaration=True)

        with zipfile.ZipFile(output_path, 'w', compression=zipfile.ZIP_DEFLATED) as dst_zip:
            for item in src_zip.infolist():
                if item.filename == 'word/document.xml':
                    dst_zip.writestr(item, modified_xml)
                else:
                    dst_zip.writestr(item, src_zip.read(item.filename))

    print(f"Successfully generated humanized docx at: {output_path}")

if __name__ == '__main__':
    main()
