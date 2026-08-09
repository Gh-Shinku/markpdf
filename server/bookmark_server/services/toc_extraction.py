from __future__ import annotations

from .pdf_rendering import render_pdf_page_image
from .toc_assembly import TOCAssembler, extract_json_text, prune_null_page_nodes
from .toc_cache import find_matching_flat_raw_cache, make_cache_file_path, make_flat_pages_work_dir
from .toc_correction import LEVEL_CORRECTION_PROMPT, correct_tree_levels, request_llm_json
from .toc_extraction_pipeline import FlatPageEventCallback, extract_toc_json
from .toc_extractors import BaseExtractor, FlatExtractor
from .toc_prompts import DEFAULT_FLAT_PROMPT, render_prompt_template
from .vlm_client import (
    DEFAULT_SAMPLING,
    SAMPLING_FIELDS,
    THINKING_WARNING,
    _read_completion_delta_text,
    _read_completion_text,
    _read_delta_field,
    build_chat_completion_options,
    llm_request_profile,
    request_chat_from_vlm,
    request_chat_from_vlm_stream,
    request_toc_from_vlm,
)


__all__ = [
    "BaseExtractor",
    "DEFAULT_FLAT_PROMPT",
    "DEFAULT_SAMPLING",
    "FlatExtractor",
    "FlatPageEventCallback",
    "LEVEL_CORRECTION_PROMPT",
    "SAMPLING_FIELDS",
    "THINKING_WARNING",
    "TOCAssembler",
    "_read_completion_delta_text",
    "_read_completion_text",
    "_read_delta_field",
    "build_chat_completion_options",
    "correct_tree_levels",
    "extract_json_text",
    "extract_toc_json",
    "find_matching_flat_raw_cache",
    "llm_request_profile",
    "make_cache_file_path",
    "make_flat_pages_work_dir",
    "prune_null_page_nodes",
    "render_pdf_page_image",
    "render_prompt_template",
    "request_chat_from_vlm",
    "request_chat_from_vlm_stream",
    "request_llm_json",
    "request_toc_from_vlm",
]
