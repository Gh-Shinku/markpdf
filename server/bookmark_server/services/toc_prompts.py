from __future__ import annotations


DEFAULT_FLAT_PROMPT = (
    "Role: You are a high-precision OCR Data Entry Clerk.\n"
    "Task: Extract ToC entries from the current page as a FLAT list of items.\n\n"
    "### Specific Rules:\n"
    "1. **Flat Output**: Do NOT nest items. Every entry must be a direct element of the root array.\n"
    "2. **Text Cleaning**: \n"
    "   - Merge multi-line titles into a single string.\n"
    "   - Remove leader dots (e.g., 'Chapter 1.......10' becomes text:'Chapter 1', page:10).\n"
    "3. **Page Range**: Only process the content visible on THIS page. Do not guess what's on the next page.\n"
    "4. **Filtering**: Ignore headers, footers, and decorative elements.\n"
    "5. **Verbatim**: Keep the original numbering (e.g., '1.2.3', 'Appendix A') within the 'text' field.\n"
    "6. **Indent Level**: Set 'indent' to the visual indentation depth of each entry relative to the leftmost ToC column on this page: 0 for top-level entries, and 1 for each deeper indentation level. Judge from indentation and font size, and keep the scale consistent within the page.\n"
    "7. **Page Numbers**: Copy the printed page number exactly as shown, as a string (e.g. '12' or 'vii'), or set to null when not visible. Roman-numeral pages are ignored by the reader, so skip such entries entirely.\n"
    "8. **Missing Page Numbers**: If an entry has no printed page number (e.g. a 'Chapter 1' heading), copy the page of the first entry that follows it within the same chapter; keep null only when no such page exists.\n\n"
    "### Output Format:\n"
    "Return ONLY a JSON array. No markdown, no conversational text.\n"
    'Schema: [{"text": "Full Title String", "page": string_or_null, "indent": integer}, ...]'
)


def render_prompt_template(
    template: str,
    toc_start: int,
    toc_end: int,
    pdf_name: str,
) -> str:
    return (
        template.replace("{toc_start}", str(toc_start + 1))
        .replace("{toc_end}", str(toc_end + 1))
        .replace("{pdf_name}", pdf_name)
    )
