# Editorial review handoff

## Status

The ten bilingual timeline cards were checked internally for clear wording, careful date precision, and claims supported by their attached sources. This is an AI-assisted editorial pass, **not professional historian or native-language sign-off**. The CSV beside this file is the review copy for a qualified Kazakh-language editor, Russian-language editor, and Kazakhstan history reviewer.

## Reviewer workflow

1. Review one row per event in `editorial-review.csv`.
2. Check Kazakh and Russian grammar, terminology, names, dates, transliteration, and whether each summary accurately reflects its linked source.
3. Enter suggested copy in the matching `*_suggested` columns; do not overwrite the current text.
4. Record unresolved historical disagreement in `historical_notes`; preserve qualified date ranges where sources do not establish a single date.
5. Set `review_status` to `approved` only after all language and historical review is complete. Apply approved wording back to `backend/app/data.py` and rerun the test suite.

## Items that need particular care

- The foundation date of the Kazakh Khanate is represented as 1465–1466, following the cited E-history account of Muhammad Haydar Dulati's dating; keep it as a range.
- For the 1986 December events, check the preferred Kazakh and Russian historical terminology and avoid adding casualty or participant counts without stronger sourcing.
- Distinguish the 1990 declaration of sovereignty from the 1991 constitutional law on independence.
- The Semipalatinsk closure citation is an archive catalog entry for decree No. 409; verify whether the cited catalog provides enough context for the final public wording.
- User-imported documents are not part of this review packet and remain unverified.

## Source policy

Use the source URLs recorded in the CSV. Prefer the legal text, state archive, United Nations, National Bank, UNESCO, and E-history records linked to each card. If a translation adds a claim not present in its source, remove it or add a corroborating source before approval.
