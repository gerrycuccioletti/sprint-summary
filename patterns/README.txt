Place your versionmatch() regex patterns here as plain text files.
One pattern per file. Filename must match your set name from JIRA_RELEASE_SETS.

Example:
  JIRA_RELEASE_SETS=2026_R4
  → create: patterns/2026_R4.txt
  → content: (?i)Guest App 1.76|MyCruise Web 1.86|Commerce SVCS Apr 26

This avoids dotenv parsing issues with | pipe characters on Windows.
The pattern is read at runtime — no restart needed after editing.
