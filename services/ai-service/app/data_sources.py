from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx


class SnapshotKnowledgeStore:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self._cache: Dict[str, Any] = {}

    def _load_json(self, name: str) -> Any:
        if name not in self._cache:
            path = self.cache_dir / name
            self._cache[name] = json.loads(path.read_text(encoding="utf-8"))
        return self._cache[name]

    def lookup_drug(self, drug_name: str) -> Optional[Dict[str, Any]]:
        aliases = self._load_json("drug_aliases.json")
        return aliases.get(drug_name)

    def get_interaction_hints(self, normalized_names: List[str]) -> List[str]:
        rules = self._load_json("interaction_rules.json")
        present = set(normalized_names)
        hints: List[str] = []
        for rule in rules:
            if rule["drugA"] in present and rule["drugB"] in present:
                hints.append(rule["hint"])
        return hints

    def get_adverse_effect_hints(self, normalized_names: List[str]) -> List[str]:
        adverse_effects = self._load_json("adverse_effects.json")
        hints: List[str] = []
        for name in normalized_names:
            hints.extend(adverse_effects.get(name, []))
        return hints

    def get_elderly_notices(self, normalized_names: List[str]) -> List[str]:
        elderly_notices = self._load_json("elderly_notices.json")
        notices: List[str] = []
        for name in normalized_names:
            notices.extend(elderly_notices.get(name, []))
        return notices

    def get_follow_up_templates(self, trigger_type: str) -> List[str]:
        templates = self._load_json("follow_up_templates.json")
        return templates.get(trigger_type, templates.get("default", []))


class LiveKnowledgeClient:
    def __init__(
        self,
        timeout: float,
        enable_openfda: bool = True,
        enable_rxnav: bool = True,
        client: Optional[httpx.Client] = None,
    ) -> None:
        self.timeout = timeout
        self.enable_openfda = enable_openfda
        self.enable_rxnav = enable_rxnav
        self.client = client or httpx.Client(timeout=timeout)

    def close(self) -> None:
        self.client.close()

    def lookup_drug(self, drug_name: str) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        if self.enable_rxnav:
            rxcui = self._lookup_rxcui(drug_name)
            if rxcui:
                result["rxcui"] = rxcui
                classes = self._lookup_rxclass(rxcui)
                if classes:
                    result["classes"] = classes
        if self.enable_openfda:
            label_hints = self._lookup_openfda_label(drug_name)
            if label_hints:
                result["adverseEffects"] = label_hints
        return result

    def _lookup_rxcui(self, drug_name: str) -> Optional[str]:
        response = self.client.get(
            "https://rxnav.nlm.nih.gov/REST/rxcui.json",
            params={"name": drug_name},
        )
        response.raise_for_status()
        payload = response.json()
        ids = payload.get("idGroup", {}).get("rxnormId", [])
        return ids[0] if ids else None

    def _lookup_rxclass(self, rxcui: str) -> List[str]:
        response = self.client.get(
            "https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json",
            params={"rxcui": rxcui, "relaSource": "ATC"},
        )
        response.raise_for_status()
        items = payload_list(
            response.json(),
            ["rxclassDrugInfoList", "rxclassDrugInfo"],
        )
        classes: List[str] = []
        for item in items:
            class_name = item.get("rxclassMinConceptItem", {}).get("className")
            if class_name:
                classes.append(class_name.upper().replace(" ", "_"))
        return classes

    def _lookup_openfda_label(self, drug_name: str) -> List[str]:
        response = self.client.get(
            "https://api.fda.gov/drug/label.json",
            params={"search": "openfda.generic_name:%s" % drug_name, "limit": 1},
        )
        response.raise_for_status()
        results = response.json().get("results", [])
        if not results:
            return []
        result = results[0]
        hints: List[str] = []
        for section in ("adverse_reactions", "warnings", "precautions"):
            values = result.get(section, [])
            for value in values[:2]:
                if isinstance(value, str):
                    hints.append(value[:180])
        return hints


def payload_list(payload: Dict[str, Any], path: List[str]) -> List[Dict[str, Any]]:
    current: Any = payload
    for key in path:
        current = current.get(key, {}) if isinstance(current, dict) else {}
    return current if isinstance(current, list) else []
