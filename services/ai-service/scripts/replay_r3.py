"""Project a local frozen manifest without a database, network, or clock dependency."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.r3_projection import ProjectionManifest, project


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists():
        parser.error('Output must be a new path; existing evidence is not overwritten')
    try:
        result = project(ProjectionManifest(**json.loads(args.manifest.read_text(encoding='utf-8-sig'))))
    except (ValueError, TypeError, KeyError, OverflowError):
        parser.error('R3_PROJECTION_INPUT_INVALID')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x', encoding='utf-8') as file:
        json.dump(result, file, ensure_ascii=False, indent=2, allow_nan=False)
    print('Projection saved:', result['projectionId'], 'events:', len(result['events']))


if __name__ == '__main__':
    main()
