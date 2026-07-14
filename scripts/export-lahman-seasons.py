#!/usr/bin/env python3
"""Export the checked-in import CSVs from an official Lahman RData release.

This is a maintainer tool, not part of the application build. It requires the
Python `rdata` and `pandas` packages and the official SABR/Lahman RData files.
"""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import pandas as pd
import rdata


def load(data_dir: Path, name: str) -> pd.DataFrame:
    return rdata.read_rda(str(data_dir / f"{name}.RData"))[name]


def num(value, default=0.0):
    return default if pd.isna(value) else float(value)


def text(value):
    return "" if value is None or pd.isna(value) else str(value)


def rounded(value, digits):
    return round(float(value), digits)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lahman-dir", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path("data-import/pool-config.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("data-import"))
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    batting = load(args.lahman_dir, "Batting")
    pitching = load(args.lahman_dir, "Pitching")
    fielding = load(args.lahman_dir, "Fielding")
    outfield = load(args.lahman_dir, "FieldingOFsplit")
    people = load(args.lahman_dir, "People")

    person = {str(row.playerID): row for row in people.itertuples()}
    seasons = []
    appearances = []

    for franchise in config["franchises"]:
        team_ids = set(franchise["lahmanTeamIds"])
        for decade in config["decades"]:
            years = set(range(decade["startYear"], decade["endYear"] + 1))
            b = batting[batting.yearID.isin(years) & batting.teamID.isin(team_ids)]
            p = pitching[pitching.yearID.isin(years) & pitching.teamID.isin(team_ids)]
            f = fielding[fielding.yearID.isin(years) & fielding.teamID.isin(team_ids)]
            ofs = outfield[outfield.yearID.isin(years) & outfield.teamID.isin(team_ids)]

            player_years = set(zip(b.playerID.astype(str), b.yearID.astype(int))) | set(zip(p.playerID.astype(str), p.yearID.astype(int)))
            included_player_years = set()
            for player_id, year in sorted(player_years, key=lambda item: (item[1], item[0])):
                br = b[(b.playerID.astype(str) == player_id) & (b.yearID == year)]
                pr = p[(p.playerID.astype(str) == player_id) & (p.yearID == year)]
                bio = person.get(player_id)
                name = " ".join(part for part in [text(getattr(bio, "nameFirst", "")), text(getattr(bio, "nameLast", ""))] if part)

                ab = num(br.AB.sum()) if len(br) else 0
                hits = num(br.H.sum()) if len(br) else 0
                walks = num(br.BB.sum()) if len(br) else 0
                hbp = num(br.HBP.sum()) if len(br) else 0
                sf = num(br.SF.sum()) if len(br) else 0
                doubles = num(br.X2B.sum()) if len(br) else 0
                triples = num(br.X3B.sum()) if len(br) else 0
                homers = num(br.HR.sum()) if len(br) else 0
                pa = ab + walks + hbp + sf
                avg = hits / ab if ab else None
                obp = (hits + walks + hbp) / (ab + walks + hbp + sf) if (ab + walks + hbp + sf) else None
                slg = (hits + doubles + 2 * triples + 3 * homers) / ab if ab else None

                ip_outs = num(pr.IPouts.sum()) if len(pr) else 0
                innings = ip_outs / 3
                earned_runs = num(pr.ER.sum()) if len(pr) else 0
                hits_allowed = num(pr.H.sum()) if len(pr) else 0
                walks_allowed = num(pr.BB.sum()) if len(pr) else 0
                era = 9 * earned_runs / innings if innings else None
                whip = (hits_allowed + walks_allowed) / innings if innings else None

                # Retain a permissive raw-import floor. The authoritative card
                # thresholds live in the Node pipeline and can be overridden.
                if pa < 50 and innings < 15:
                    continue
                included_player_years.add((player_id, year))

                seasons.append({
                    "playerId": player_id,
                    "baseballReferenceId": text(getattr(bio, "bbrefID", "")),
                    "name": name,
                    "franchiseId": franchise["id"],
                    "teamAbbreviation": franchise["abbreviation"],
                    "teamDisplayName": franchise["displayName"],
                    "decade": decade["id"],
                    "season": year,
                    "bats": text(getattr(bio, "bats", "")),
                    "throws": text(getattr(bio, "throws", "")),
                    "hitterGames": int(num(br.G.sum())) if len(br) else "",
                    "plateAppearances": int(pa) if pa else "",
                    "atBats": int(ab) if ab else "",
                    "hits": int(hits) if ab else "",
                    "doubles": int(doubles) if ab else "",
                    "triples": int(triples) if ab else "",
                    "homeRuns": int(homers) if ab else "",
                    "rbi": int(num(br.RBI.sum())) if len(br) else "",
                    "stolenBases": int(num(br.SB.sum())) if len(br) else "",
                    "walks": int(walks) if ab else "",
                    "hitByPitch": int(hbp) if ab else "",
                    "sacrificeFlies": int(sf) if ab else "",
                    "avg": rounded(avg, 3) if avg is not None else "",
                    "obp": rounded(obp, 3) if obp is not None else "",
                    "slg": rounded(slg, 3) if slg is not None else "",
                    "pitcherGames": int(num(pr.G.sum())) if len(pr) else "",
                    "wins": int(num(pr.W.sum())) if len(pr) else "",
                    "gamesStarted": int(num(pr.GS.sum())) if len(pr) else "",
                    "saves": int(num(pr.SV.sum())) if len(pr) else "",
                    "inningsPitched": rounded(innings, 1) if innings else "",
                    "hitsAllowed": int(hits_allowed) if innings else "",
                    "earnedRuns": int(earned_runs) if innings else "",
                    "homeRunsAllowed": int(num(pr.HR.sum())) if len(pr) else "",
                    "walksAllowed": int(walks_allowed) if innings else "",
                    "strikeouts": int(num(pr.SO.sum())) if len(pr) else "",
                    "era": rounded(era, 2) if era is not None else "",
                    "whip": rounded(whip, 3) if whip is not None else "",
                    "lahmanTeamIds": "|".join(sorted(set(map(str, br.teamID.tolist() + pr.teamID.tolist())))),
                })

            field_rows = []
            for source, allowed in [(f, {"C", "1B", "2B", "3B", "SS"}), (ofs, {"LF", "CF", "RF"})]:
                grouped = source.groupby(["playerID", "yearID", "POS"], as_index=False).agg({"G": "sum", "GS": "sum"})
                for row in grouped.itertuples():
                    if str(row.POS) not in allowed:
                        continue
                    if (str(row.playerID), int(row.yearID)) not in included_player_years:
                        continue
                    field_rows.append({
                        "playerId": str(row.playerID), "franchiseId": franchise["id"], "decade": decade["id"],
                        "season": int(row.yearID), "position": str(row.POS), "games": int(num(row.G)),
                        "gamesStarted": int(num(row.GS)),
                    })
            appearances.extend(field_rows)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    season_path = args.output_dir / "season-stats.csv"
    fielding_path = args.output_dir / "fielding-appearances.csv"
    with season_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(seasons[0]), lineterminator="\n")
        writer.writeheader(); writer.writerows(seasons)
    with fielding_path.open("w", newline="", encoding="utf-8") as handle:
        # Preserve the historical checked-in fielding CSV line endings. The
        # season file intentionally moved to LF when its schema was extended.
        writer = csv.DictWriter(handle, fieldnames=list(appearances[0]), lineterminator="\r\n")
        writer.writeheader(); writer.writerows(appearances)
    print(f"Exported {len(seasons)} season rows and {len(appearances)} fielding rows.")


if __name__ == "__main__":
    main()
