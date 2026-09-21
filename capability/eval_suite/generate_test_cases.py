#!/usr/bin/env python3
"""generate_test_cases.py — build TEST_CASES.jsonl deterministically.

Process discipline: culture-dependent cases score PROCESS, uncertainty
handling, stakeholder plans, evidence discipline — never a guessed
universal norm. 'correct_answer' keys are forbidden. Run:
python3 generate_test_cases.py  -> writes TEST_CASES.jsonl in parent dir.
"""
import json, os

OUT = os.path.join(os.path.dirname(__file__), "..", "TEST_CASES.jsonl")
META = {"version": "1.0.0", "generated": "2026-09-04", "license": "internal"}