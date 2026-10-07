#!/usr/bin/env python3
"""
Tessera AI — DOCX Humanizer Worker
Extracts body paragraphs from a Word (.docx) document,
humanizes prose using Gemini API with the Zero-AI-Detection Rubric,
and writes back into the WordprocessingML zip while preserving all styles, figures, and formatting.
"""

import sys
import os
import json
import zipfile
import urllib.request
import urllib.error
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
    ("Crucially, ", ""),
    ("In recent years, ", ""),
    ("plays a pivotal role in", "is essential for"),
    ("plays a crucial role in", "directly influences"),
    ("delve into", "examine"),
    ("delves into", "examines"),
    ("delving into", "examining"),
    ("underscores the importance of", "highlights"),
    ("underscores", "demonstrates"),
    ("delineates", "details"),
    ("fosters", "enables"),
    ("landscape", "domain"),
    ("tapestry", "framework"),
    ("beacon", "foundation"),
    ("testament", "evidence"),
    ("paramount", "essential"),
    ("pivotal", "central"),
    ("Our synthesis of the literature reveals", "Looking across the literature, we identify"),
    ("Our evaluation of the literature uncovers", "Benchmarking across the studies reveals"),
    ("Our inquiry is structured around", "We frame this inquiry around"),
    ("Our systematic review provides", "This synthesis offers"),
]

def clean_markers(text):
    for old, new in BANNED_AI_REPLACEMENTS:
        text = text.replace(old, new)
        text = text.replace(old.lower(), new.lower())
    return text.strip()

def call_gemini(api_key, prompt):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.90,
            "topP": 0.95
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data['candidates'][0]['content']['parts'][0]['text']

def humanize_paragraph(api_key, text):
    if len(text.strip()) < 80:
        return text

    prompt = f"""You are an experienced research engineer and peer reviewer writing in an authentic, natural human scholarly voice.
Rewrite and humanize this academic paragraph so that AI detectors (Turnitin, GPTZero, Copyleaks) classify it as 100% HUMAN (< 5% AI probability).

MANDATORY WRITING DIRECTIVES:
1. EXTREME BURSTINESS: You MUST alternate between ultra-short, punchy declarations (3-7 words) and long, multi-clause complex sentences (30-45 words).
   Examples of punchy human sentences: "The bottleneck is latency." "Simulations hide these costs." "Hardware realities bite hard." "The numbers look promising on paper."
2. HIGH-PERPLEXITY SCHOLARLY VOICE: Use natural, varied academic expressions and concrete engineering skepticism. Avoid formulaic symmetry or robotic sentence structures.
3. FORBIDDEN AI OPENINGS & WORDS:
   - NEVER start paragraphs with "Our inquiry...", "Our synthesis...", "In recent years,", "To bridge this gap,", "Furthermore,", "Moreover,".
   - Absolutely FORBIDDEN words: delve, tapestry, beacon, testament, pivotal, paramount, crucial, vital, multifaceted, plethora, myriad, cornerstone, revolutionize, ever-evolving, landscape, underscores, delineates, fosters.
4. ABSOLUTE CITATION & FACT FIDELITY: Retain ALL citations (author names and years), metrics, technical acronyms (RIS, GNN, THz, CSI), and Figure/Table references VERBATIM.
5. Return ONLY the humanized paragraph. Do NOT add meta commentary, markdown tags, or quotation marks.

PARAGRAPH TO HUMANIZE:
{text}"""

    try:
        rewritten = call_gemini(api_key, prompt)
        return clean_markers(rewritten.strip())
    except Exception as e:
        print(f"Gemini API warning for paragraph: {e}", file=sys.stderr)
        return clean_markers(text)

def main():
    if len(sys.argv) < 4:
        print("Usage: docxHumanizerWorker.py <input.docx> <output.docx> <gemini_api_key>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    api_key = sys.argv[3]

    print(f"Processing docx: {input_path}")
    
    with zipfile.ZipFile(input_path, 'r') as src_zip:
        xml_content = src_zip.read('word/document.xml')
        tree = ET.fromstring(xml_content)

        paragraphs_to_process = []
        for p in tree.findall('.//w:p', NS_MAP):
            # Skip if heading
            pPr = p.find('w:pPr', NS_MAP)
            if pPr is not None:
                pStyle = pPr.find('w:pStyle', NS_MAP)
                if pStyle is not None and 'Heading' in pStyle.attrib.get(f'{{{W_NS}}}val', ''):
                    continue

            # Skip if contains drawings (images)
            if p.findall('.//w:drawing', NS_MAP):
                continue

            t_nodes = p.findall('.//w:t', NS_MAP)
            full_text = ''.join(t.text for t in t_nodes if t.text).strip()

            # Skip short metadata, references header, or bibliography lines
            if len(full_text) < 130 or full_text.startswith('http') or full_text.startswith('References') or full_text.startswith('Keywords:'):
                continue

            paragraphs_to_process.append((p, full_text, t_nodes))

        print(f"Found {len(paragraphs_to_process)} substantive body paragraphs to humanize.")

        for idx, (p_node, raw_text, t_nodes) in enumerate(paragraphs_to_process):
            print(f"[{idx+1}/{len(paragraphs_to_process)}] Humanizing: {raw_text[:60]}...")
            humanized_text = humanize_paragraph(api_key, raw_text)

            # Put humanized text into first <w:t> and clear the others to preserve run styles
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
