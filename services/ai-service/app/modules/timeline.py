from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List

from app.domain import TemporalBundle, TemporalWindow, TimelineEvent


class TemporalAlignmentModule:
    def align(
        self,
        events: List[Dict[str, Any]],
        medications: List[Dict[str, Any]],
        profile: Dict[str, Any],
        time_window: Dict[str, Any],
    ) -> TemporalBundle:
        window = TemporalWindow(
            start=_parse_datetime(str(time_window["start"])),
            end=_parse_datetime(str(time_window["end"])),
            label=self._classify_window(time_window),
        )
        aligned_events: List[TimelineEvent] = []
        for event in events:
            event_time = _parse_datetime(str(event["time"]))
            if window.start <= event_time <= window.end:
                aligned_events.append(
                    TimelineEvent(
                        event_type=str(event.get("type", "")).upper(),
                        event_time=event_time,
                        payload=dict(event.get("payload", {})),
                        raw=event,
                    )
                )

        aligned_events.sort(key=lambda item: item.event_time)
        grouped: Dict[str, List[TimelineEvent]] = {}
        for item in aligned_events:
            grouped.setdefault(item.event_type, []).append(item)

        return TemporalBundle(
            events=aligned_events,
            medications=medications,
            profile=profile,
            time_window=window,
            grouped_events=grouped,
        )

    def _classify_window(self, time_window: Dict[str, Any]) -> str:
        start = _parse_datetime(str(time_window["start"]))
        end = _parse_datetime(str(time_window["end"]))
        delta_hours = (end - start).total_seconds() / 3600

        if delta_hours <= 4:
            return "MEDICATION_OR_MEAL"
        if delta_hours <= 14 and start.hour >= 20:
            return "NIGHT_TO_MORNING"
        if 7 <= delta_hours / 24 <= 14:
            return "REVIEW_AGGREGATION"
        return "GENERAL"


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
