#!/usr/bin/env python3
"""
Tessera AI — DOCX Academic Humanizer Worker
Extracts body paragraphs from a Word (.docx) document,
humanizes prose using free anti-detection models (Groq Llama 3.3 70B, OpenRouter Free, AIHumanizerAPI, Gemini, or Claude),
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

HUMANIZER_SYSTEM_PROMPT = """You are a distinguished IEEE Transactions senior fellow and rigorous peer reviewer writing in an authentic, high-precision academic voice.
Rewrite and thoroughly humanize this academic paragraph so that AI detectors (Turnitin 2026, GPTZero, Copyleaks) classify it as 100% human (< 8% AI probability).

MANDATORY WRITING DIRECTIVES:
1. DYNAMIC SYNTACTIC BURSTINESS: Aggressively alternate between short punchy technical assertions (4-8 words) and long, multi-clause analytical sentences (30-45 words).
   Examples of punchy human technical sentences: "Propagation path losses are severe." "Hardware constraints limit performance." "Phase noise degrades accuracy." "Theory diverges from silicon."
2. AUTHENTIC SCHOLARLY REGISTER (NO SLANG OR CASUAL METAPHORS):
   - Never use casual humanizer slang (e.g. "cranking up", "sound impossible", "academic silos", "pulled off", "neat trick"). Turnitin specifically flags casual idioms as "AI-generated and revised by AI".
   - Use rigorous academic phrasing: "empirical divergence", "circuit-level thermal dissipation", "phase quantization error", "Rayleigh fading bounds".
3. FORBIDDEN AI OPENINGS & WORDS:
   - NEVER start paragraphs with "Our inquiry...", "Our synthesis...", "In recent years,", "To bridge this gap,", "Furthermore,", "Moreover,".
   - Absolutely FORBIDDEN words: delve, tapestry, beacon, testament, pivotal, paramount, crucial, vital, multifaceted, plethora, myriad, cornerstone, revolutionize, ever-evolving, landscape, underscores, delineates, fosters.
4. CITATION & METRIC FIDELITY: Retain ALL citations (author names and years or [1], [2]), technical metrics, acronyms (RIS, GNN, THz, CSI), and Figure/Table references VERBATIM.
5. Return ONLY the rewritten humanized paragraph. Do NOT add meta commentary, markdown tags, or quotation marks."""

def clean_markers(text):
    if not text:
        return ""
    for old, new in BANNED_AI_REPLACEMENTS:
        text = text.replace(old, new)
        text = text.replace(old.lower(), new.lower())
    return text.strip()

def call_aihumanizer(api_key, text):
    url = "https://api.aihumanizerapi.com/v1/humanize"
    payload = {
        "text": text,
        "model": "academic",
        "tone": "scholarly"
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}'
        }
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data.get('humanized_text') or data.get('result') or data.get('text') or text

def call_groq(api_key, text):
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": HUMANIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"PARAGRAPH TO HUMANIZE:\n{text}"}
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
    with urllib.request.urlopen(req, timeout=45) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data['choices'][0]['message']['content']

def call_openrouter(api_key, text):
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model": "meta-llama/llama-3.3-70b-instruct:free",
        "messages": [
            {"role": "system", "content": HUMANIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"PARAGRAPH TO HUMANIZE:\n{text}"}
        ],
        "temperature": 0.85
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
            'HTTP-Referer': 'https://tessera-ai.org',
            'X-Title': 'Tessera AI'
        }
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data['choices'][0]['message']['content']

def call_claude(api_key, text):
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": "claude-3-5-sonnet-20241022",
        "max_tokens": 4096,
        "temperature": 0.85,
        "system": HUMANIZER_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": f"PARAGRAPH TO HUMANIZE:\n{text}"}]
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01'
        }
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        data = json.loads(response.read().decode('utf-8'))
        return data['content'][0]['text']

def call_gemini(api_key, text):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    full_prompt = f"{HUMANIZER_SYSTEM_PROMPT}\n\nPARAGRAPH TO HUMANIZE:\n{text}"
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
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

def humanize_paragraph(text, gemini_key=None, anthropic_key=None, groq_key=None, openrouter_key=None, aihumanizer_key=None):
    if len(text.strip()) < 80:
        return text

    # 1. Try AIHumanizerAPI if key available (10k words free, dedicated model)
    if aihumanizer_key and aihumanizer_key != 'none':
        try:
            print("  [Model: AIHumanizerAPI] Rewriting paragraph...", file=sys.stderr)
            rewritten = call_aihumanizer(aihumanizer_key, text)
            if rewritten:
                return clean_markers(rewritten.strip())
        except Exception as e:
            print(f"AIHumanizerAPI notice: {e}", file=sys.stderr)

    # 2. Try Groq (Llama 3.3 70B) if key available (100% Free)
    if groq_key and groq_key != 'none':
        try:
            print("  [Model: Groq Llama 3.3 70B Free] Rewriting paragraph...", file=sys.stderr)
            rewritten = call_groq(groq_key, text)
            if rewritten:
                return clean_markers(rewritten.strip())
        except Exception as e:
            print(f"Groq notice: {e}", file=sys.stderr)

    # 3. Try OpenRouter Free (Llama 3.3 70B Free)
    if openrouter_key and openrouter_key != 'none':
        try:
            print("  [Model: OpenRouter Free Llama 3.3] Rewriting paragraph...", file=sys.stderr)
            rewritten = call_openrouter(openrouter_key, text)
            if rewritten:
                return clean_markers(rewritten.strip())
        except Exception as e:
            print(f"OpenRouter notice: {e}", file=sys.stderr)

    # 4. Try Claude 3.5 Sonnet if key available
    if anthropic_key and anthropic_key != 'none':
        try:
            print("  [Model: Claude 3.5 Sonnet] Rewriting paragraph...", file=sys.stderr)
            rewritten = call_claude(anthropic_key, text)
            if rewritten:
                return clean_markers(rewritten.strip())
        except Exception as e:
            print(f"Claude notice: {e}", file=sys.stderr)

    # 5. Gemini fallback
    if gemini_key and gemini_key != 'none':
        try:
            print("  [Model: Gemini 2.5 Flash] Rewriting paragraph...", file=sys.stderr)
            rewritten = call_gemini(gemini_key, text)
            if rewritten:
                return clean_markers(rewritten.strip())
        except Exception as e:
            print(f"Gemini notice: {e}", file=sys.stderr)

    return clean_markers(text)

def main():
    if len(sys.argv) < 3:
        print("Usage: docxHumanizerWorker.py <input.docx> <output.docx> [gemini_key] [anthropic_key] [groq_key] [openrouter_key] [aihumanizer_key]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    gemini_key = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'none' else os.environ.get('GEMINI_API_KEY')
    anthropic_key = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] != 'none' else os.environ.get('ANTHROPIC_API_KEY')
    groq_key = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] != 'none' else os.environ.get('GROQ_API_KEY')
    openrouter_key = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] != 'none' else os.environ.get('OPENROUTER_API_KEY')
    aihumanizer_key = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] != 'none' else os.environ.get('AI_HUMANIZER_API_KEY')

    print(f"Processing docx: {input_path}")
    print(f"Active Engines: Groq={'YES' if groq_key else 'NO'}, OpenRouter={'YES' if openrouter_key else 'NO'}, AIHumanizer={'YES' if aihumanizer_key else 'NO'}, Claude={'YES' if anthropic_key else 'NO'}, Gemini={'YES' if gemini_key else 'NO'}")
    
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

            paragraphs_to_process.append((p, full_text, t_nodes))

        print(f"Found {len(paragraphs_to_process)} substantive body paragraphs to humanize.")

        for idx, (p_node, raw_text, t_nodes) in enumerate(paragraphs_to_process):
            print(f"[{idx+1}/{len(paragraphs_to_process)}] Humanizing paragraph...")
            humanized_text = humanize_paragraph(
                raw_text,
                gemini_key=gemini_key,
                anthropic_key=anthropic_key,
                groq_key=groq_key,
                openrouter_key=openrouter_key,
                aihumanizer_key=aihumanizer_key
            )

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
