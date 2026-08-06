from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import fitz
import pytest

from bookmark_server.services import toc_extraction as te
from bookmark_server.services.toc_extraction import (
    FlatExtractor,
    TOCAssembler,
    correct_tree_levels,
    extract_toc_json,
)


def _tree_of(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return TOCAssembler().assemble(items)


def _flat(text: str, page: int | None, indent: int | None) -> dict[str, Any]:
    return {"text": text, "page": page, "indent": indent}


def _titles(nodes: list[dict[str, Any]]) -> list[str]:
    result: list[str] = []
    for node in nodes:
        result.append(node["title"])
        result.extend(_titles(node["children"]))
    return result


class TestIndentLevelAssembly:
    def test_basic_indent_tree(self) -> None:
        tree = _tree_of(
            [
                _flat("Chapter 1", 1, 0),
                _flat("1.1 Section", 2, 1),
                _flat("1.1.1 Sub", 3, 2),
                _flat("1.2 Section", 4, 1),
                _flat("Chapter 2", 5, 0),
            ]
        )
        assert _titles(tree) == ["Chapter 1", "1.1 Section", "1.1.1 Sub", "1.2 Section", "Chapter 2"]
        assert [node["title"] for node in tree] == ["Chapter 1", "Chapter 2"]
        assert tree[0]["children"][0]["title"] == "1.1 Section"
        assert tree[0]["children"][0]["children"][0]["title"] == "1.1.1 Sub"

    def test_cross_page_indent_scale_jump_is_absorbed(self) -> None:
        # Page 2 uses a coarser indent scale for its sub-entries (2 per level
        # instead of 1); the dedent logic and depth clamp absorb the jump.
        tree = _tree_of(
            [
                _flat("Chapter 1", 1, 0),
                _flat("1.1 Section", 2, 1),
                _flat("Chapter 2", 3, 0),
                # page 2 starts here
                _flat("2.1 Section", 4, 2),
                _flat("2.2 Section", 5, 2),
                _flat("Chapter 3", 6, 0),
                _flat("3.1 Section", 7, 2),
            ]
        )
        assert [node["title"] for node in tree] == ["Chapter 1", "Chapter 2", "Chapter 3"]
        assert [c["title"] for c in tree[1]["children"]] == ["2.1 Section", "2.2 Section"]
        assert [c["title"] for c in tree[2]["children"]] == ["3.1 Section"]

    def test_skipped_level_is_clamped_to_one_level(self) -> None:
        tree = _tree_of(
            [
                _flat("Chapter 1", 1, 0),
                _flat("1.1 Section", 2, 1),
                _flat("1.1.1 Sub", 3, 3),  # VLM skipped an indent level
                _flat("1.1.1.1 Deep", 4, 4),
            ]
        )
        assert tree[0]["children"][0]["children"][0]["title"] == "1.1.1 Sub"
        assert tree[0]["children"][0]["children"][0]["children"][0]["title"] == "1.1.1.1 Deep"

    def test_flattened_page_left_for_correction(self) -> None:
        # A whole page whose entries were flattened by the VLM (all indent 0)
        # cannot be recovered from indent alone; the tree keeps them as siblings
        # and the LLM correction stage is expected to fix the nesting.
        tree = _tree_of(
            [
                _flat("Chapter 1", 1, 0),
                _flat("1.1 Section", 2, 0),
                _flat("1.2 Section", 3, 0),
            ]
        )
        assert [node["title"] for node in tree] == ["Chapter 1", "1.1 Section", "1.2 Section"]

    def test_dedent_returns_to_ancestor_level(self) -> None:
        tree = _tree_of(
            [
                _flat("Part I", 1, 0),
                _flat("Chapter 1", 2, 1),
                _flat("1.1 Section", 3, 2),
                _flat("Chapter 2", 4, 1),
                _flat("Part II", 5, 0),
            ]
        )
        assert tree[0]["children"][0]["children"][0]["title"] == "1.1 Section"
        assert tree[0]["children"][1]["title"] == "Chapter 2"
        assert tree[1]["title"] == "Part II"

    def test_numbered_entries_nest_under_chapter_without_indent(self) -> None:
        tree = _tree_of(
            [
                _flat("Preface", 9, None),
                _flat("Chapter 1", None, None),
                _flat("1. Introduction", 1, None),
                _flat("1.1 Section", 2, None),
                _flat("2. Theory", 3, None),
                _flat("Chapter 2", 13, None),
                _flat("1. Introduction", 13, None),
            ]
        )
        assert [node["title"] for node in tree] == ["Preface", "Chapter 1", "Chapter 2"]
        assert [c["title"] for c in tree[1]["children"]] == [
            "1. Introduction",
            "2. Theory",
        ]
        assert tree[1]["children"][0]["children"][0]["title"] == "1.1 Section"

    def test_monotonic_filter_keeps_front_matter_page_reset(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=1)
        filtered = extractor._filter_anomalies_by_monotonic_page(
            [
                _flat("Preface", 9, 0),
                _flat("Acknowledgments", 11, 0),
                _flat("Chapter 1", None, 0),
                _flat("1. Introduction", 1, 0),
                _flat("2. Theory of Feedback Control", 1, 0),
            ]
        )
        # 前置页页码(9, 11)高于正文第一页(1):回退但文本不重复,必须保留。
        assert [item["text"] for item in filtered] == [
            "Preface",
            "Acknowledgments",
            "Chapter 1",
            "1. Introduction",
            "2. Theory of Feedback Control",
        ]

    def test_monotonic_filter_still_drops_repeated_regressions(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=1)
        filtered = extractor._filter_anomalies_by_monotonic_page(
            [
                _flat("Chapter 1", 1, 0),
                _flat("1. Introduction", 2, 0),
                _flat("Chapter 1", 1, 0),  # 页眉噪声:页码回退且文本重复
                _flat("1. Introduction", 1, 0),  # 页眉噪声
            ]
        )
        assert [item["text"] for item in filtered] == ["Chapter 1", "1. Introduction"]

    def test_missing_indent_falls_back_to_heuristics(self) -> None:
        tree = _tree_of(
            [
                _flat("Chapter 1", 1, None),
                _flat("  1.1 Section", 2, None),
                _flat("1.2 Section", 3, None),
            ]
        )
        assert tree[0]["children"][0]["title"] == "1.1 Section"

    def test_heal_cross_page_merges_continuation_across_pages(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=1)
        healed = extractor.assembler._heal_cross_page(
            [
                {"text": "Chapter 1: A Long", "page": 1, "indent": 1, "_page_index": 0},
                {"text": "Title", "page": None, "indent": 1, "_page_index": 1},
            ]
        )
        assert healed == [{"text": "Chapter 1: A LongTitle", "page": 1, "indent": 1}]

    def test_heal_keeps_same_page_null_entry_independent(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        healed = extractor.assembler._heal_cross_page(
            [
                {"text": "Acknowledgments", "page": 11, "indent": 0, "_page_index": 0},
                {"text": "Chapter 1 STOCHASTIC CONTROL", "page": None, "indent": 0, "_page_index": 0},
            ]
        )
        assert healed == [
            {"text": "Acknowledgments", "page": 11, "indent": 0},
            {"text": "Chapter 1 STOCHASTIC CONTROL", "page": None, "indent": 0},
        ]

    def test_missing_page_inherited_from_first_child(self) -> None:
        tree = _tree_of(
            [
                _flat("Chapter 1", None, 0),
                _flat("1. Introduction", 1, 1),
                _flat("Chapter 2", None, 0),
                _flat("1. Introduction", 13, 1),
            ]
        )
        assert tree[0]["page"] == 1
        assert tree[1]["page"] == 13

    def test_roman_page_entries_excluded_from_final_tree(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        flat = extractor._validate_flat_list(
            [
                {"text": "Preface", "page": "vii", "indent": 0},
                {"text": "Introduction", "page": "x", "indent": 0},
                {"text": "Chapter 1", "page": "1", "indent": 0},
                {"text": "1.1 Section", "page": "2", "indent": 1},
            ]
        )
        tree = extractor.assembler.assemble(flat)
        assert [node["title"] for node in tree] == ["Chapter 1"]
        assert tree[0]["children"][0]["title"] == "1.1 Section"


class TestFlatListValidation:
    def test_indent_accepted(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        assert extractor._validate_flat_list([_flat("A", 1, 2)]) == [
            {"text": "A", "page": 1, "indent": 2}
        ]

    def test_missing_indent_accepted_for_legacy_cache(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        assert extractor._validate_flat_list([{"text": "A", "page": 1}]) == [
            {"text": "A", "page": 1, "indent": None}
        ]

    def test_invalid_indent_rejected(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        for bad in (-1, 1.5, "1", True):
            with pytest.raises(ValueError):
                extractor._validate_flat_list([{"text": "A", "page": 1, "indent": bad}])

    def test_roman_numeral_pages_dropped(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        result = extractor._validate_flat_list(
            [
                {"text": "Preface", "page": "vii", "indent": 0},
                {"text": "Introduction", "page": "xii", "indent": 0},
                {"text": "Foreword", "page": "III", "indent": 0},
            ]
        )
        assert result == []

    def test_digit_string_pages_converted_to_int(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        result = extractor._validate_flat_list(
            [
                {"text": "Chapter 1", "page": "12", "indent": 0},
                {"text": "Chapter 2", "page": "25.", "indent": 0},
                {"text": "Chapter 3", "page": 30, "indent": 0},
                {"text": "Chapter 4", "page": None, "indent": 0},
            ]
        )
        assert result == [
            {"text": "Chapter 1", "page": 12, "indent": 0},
            {"text": "Chapter 2", "page": 25, "indent": 0},
            {"text": "Chapter 3", "page": 30, "indent": 0},
            {"text": "Chapter 4", "page": None, "indent": 0},
        ]

    def test_unparseable_page_strings_dropped(self) -> None:
        extractor = FlatExtractor(toc_start=0, toc_end=0)
        result = extractor._validate_flat_list(
            [
                {"text": "A", "page": "12a", "indent": 0},
                {"text": "B", "page": "", "indent": 0},
            ]
        )
        assert result == []


class TestLevelCorrection:
    def test_correction_applied(self, monkeypatch) -> None:
        corrected = [
            {"title": "Chapter 1", "page": 1, "attribute": "relative", "children": []},
        ]
        monkeypatch.setattr(te, "request_llm_json", lambda **kwargs: json.dumps(corrected))
        result = correct_tree_levels(
            [{"title": "x", "page": 1, "attribute": "relative", "children": []}],
            api_key="k",
            base_url="http://x",
            model="m",
        )
        assert result == corrected

    def test_correction_failure_raises(self, monkeypatch) -> None:
        def bad_response(**kwargs):
            raise RuntimeError("api down")

        monkeypatch.setattr(te, "request_llm_json", bad_response)
        with pytest.raises(RuntimeError):
            correct_tree_levels(
                [{"title": "x", "page": 1, "attribute": "relative", "children": []}],
                api_key="k",
                base_url="http://x",
                model="m",
            )


def _make_pdf(path: Path, page_count: int = 2) -> None:
    doc = fitz.open()
    for _ in range(page_count):
        doc.new_page()
    doc.save(path)
    doc.close()


class TestExtractionIntegration:
    def test_flat_extraction_writes_corrected_tree(self, tmp_path: Path, monkeypatch) -> None:
        input_pdf = tmp_path / "book.pdf"
        _make_pdf(input_pdf)

        page_items = [
            [{"text": "Chapter 1", "page": 1, "indent": 0}],
            [{"text": "1.1 Section", "page": 2, "indent": 0}],  # wrong: should be indent 1
        ]
        call_index = [0]

        def fake_vlm(image_data_urls, prompt, api_key, base_url, model):
            items = page_items[call_index[0]]
            call_index[0] += 1
            return json.dumps(items)

        corrected_tree = [
            {
                "title": "Chapter 1",
                "page": 1,
                "attribute": "relative",
                "children": [
                    {"title": "1.1 Section", "page": 2, "attribute": "relative", "children": []}
                ],
            }
        ]

        def fake_llm(prompt, api_key, base_url, model):
            assert "children" in prompt
            return json.dumps(corrected_tree)

        monkeypatch.setattr(te, "request_toc_from_vlm", fake_vlm)
        monkeypatch.setattr(te, "request_llm_json", fake_llm)

        toc_data, cache_file, loaded_from_cache, raw_cache_file, stats = extract_toc_json(
            input_pdf=input_pdf,
            toc_start=0,
            toc_end=1,
            api_key="k",
            base_url="http://x",
            model="m",
            dpi=220,
            cache_dir=tmp_path / "cache",
            overwrite_cache=False,
        )

        assert stats["level_correction"] == "applied"
        assert toc_data == corrected_tree
        assert json.loads(cache_file.read_text(encoding="utf-8")) == corrected_tree

        # Second run hits the final cache and skips VLM + correction entirely.
        toc_data2, _, loaded_from_cache2, _, stats2 = extract_toc_json(
            input_pdf=input_pdf,
            toc_start=0,
            toc_end=1,
            api_key="k",
            base_url="http://x",
            model="m",
            dpi=220,
            cache_dir=tmp_path / "cache",
            overwrite_cache=False,
        )
        assert loaded_from_cache2
        assert toc_data2 == corrected_tree

    def test_correction_failure_falls_back_to_assembled_tree(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        input_pdf = tmp_path / "book.pdf"
        _make_pdf(input_pdf)

        page_items = [
            [{"text": "Chapter 1", "page": 1, "indent": 0}],
            [{"text": "Chapter 2", "page": 2, "indent": 0}],
        ]
        call_index = [0]

        def fake_vlm(image_data_urls, prompt, api_key, base_url, model):
            items = page_items[call_index[0]]
            call_index[0] += 1
            return json.dumps(items)

        monkeypatch.setattr(te, "request_toc_from_vlm", fake_vlm)
        monkeypatch.setattr(
            te,
            "request_llm_json",
            lambda **kwargs: (_ for _ in ()).throw(RuntimeError("api down")),
        )

        toc_data, _, _, _, stats = extract_toc_json(
            input_pdf=input_pdf,
            toc_start=0,
            toc_end=1,
            api_key="k",
            base_url="http://x",
            model="m",
            dpi=220,
            cache_dir=tmp_path / "cache",
            overwrite_cache=False,
        )

        assert stats["level_correction"] == "failed"
        assert [node["title"] for node in toc_data] == ["Chapter 1", "Chapter 2"]
