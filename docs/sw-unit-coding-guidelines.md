# SW Unit Coding Guidelines
## Header Format for Traceability

Every source file that represents an SW unit must start with a structured comment block immediately after any copyright notice. This block is parsed automatically by the Safety PLM tool when you upload a ZIP to create or update SW units.

---

## Standard Header Template

```c
/**
 * @unit    <unit-code>
 * @name    <human-readable name>
 * @type    <unit-type>
 * @asil    <ASIL level>
 * @sdd     <SDD document reference>
 * @req     <requirement IDs, comma-separated>
 * @author  <author name or team>
 * @language <language hint>
 *
 * <Optional free-text description>
 */
```

---

## Keyword Reference

| Keyword | Required | Description | Example |
|---------|----------|-------------|---------|
| `@unit` | **Yes** | Unique unit code. Must match the identifier in the SW architecture. | `SWU-MOT-001` |
| `@name` | **Yes** | Short, descriptive name for the unit. | `Motor Control` |
| `@type` | Recommended | Unit type. See valid values below. | `function` |
| `@asil` | Recommended | ASIL integrity level per ISO 26262 / DO-178C DAL. | `B` |
| `@sdd` | Recommended | Reference to the SW Detailed Design document or section. | `SDD-MOT-001` |
| `@req` | Recommended | Comma-separated list of SW requirements this unit implements. | `SWR-MOT-001, SWR-MOT-002` |
| `@author` | Optional | Developer name or team responsible for this unit. | `A. Guerrero` |
| `@language` | Optional | Override language detection (use file extension: `c`, `cpp`, `py`, etc.). Useful for `.h` files shared between C and C++. | `c` |

---

## Valid Unit Types (`@type`)

| Value | Meaning |
|-------|---------|
| `function` | A standalone function or method |
| `class` | A C++ class or equivalent |
| `isr` | Interrupt Service Routine |
| `task` | RTOS task or thread |
| `state_machine` | Finite state machine implementation |
| `calibration` | Calibration data, lookup tables, or configuration constants |
| `general` | General-purpose code not covered by the above |

> **Project-specific types** can be added in **Project Settings → SW Unit Types**. Use the configured key value in the `@type` field.

---

## ASIL Level Values

For **ISO 26262** projects: `QM`, `A`, `B`, `C`, `D`  
For **DO-178C** projects: `DAL-A`, `DAL-B`, `DAL-C`, `DAL-D`, `DAL-E`  
For non-safety items: leave blank or use `QM` / `DAL-E`

---

## Traceability Chain

The keywords create the following traceability links inside the tool:

```
SW Requirement (SWR-xxx)  ←─ @req ──→  SW Unit (SWU-xxx)
SW Detailed Design (SDD-xxx) ←─ @sdd ──→  SW Unit (SWU-xxx)
```

This supports **ASPICE SWE.3** (SW Detailed Design) and **SWE.4** (SW Unit Verification) traceability requirements.

---

## Complete C Example

```c
/**
 * @unit    SWU-MOT-001
 * @name    Motor Control
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-001, SWR-MOT-002, SWR-MOT-003
 * @author  A. Guerrero
 * @language c
 *
 * Controls the brushless DC motor speed and direction.
 * Implements PID regulation with anti-windup and safety cut-off.
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>
#include <stdbool.h>
```

---

## Complete Python Example

```python
"""
@unit     SWU-DIAG-001
@name     Diagnostic Logger
@type     class
@asil     QM
@sdd      SDD-DIAG-001
@req      SWR-DIAG-001
@author   A. Guerrero
@language py

Collects runtime diagnostic events and writes them to the log buffer.
"""

class DiagnosticLogger:
    ...
```

---

## Header Placement Rules

1. The header block must be within the **first 30 lines** of the file (the parser only scans the top of the file for performance).
2. Each keyword must appear **once**. If a keyword appears multiple times, the first occurrence wins.
3. Leading comment characters (`*`, `/`, `#`, spaces) before a keyword are stripped automatically — you do not need to align them exactly.
4. The `@req` value may contain multiple IDs separated by commas and optional spaces: `SWR-001, SWR-002, SWR-003`.

---

## Configuring Keywords

If your project uses different conventions (e.g. `@id` instead of `@unit`, or `@safety` instead of `@asil`), go to:

**Project Settings → Header Keywords**

and update each keyword to match your project's internal coding standard. The parser will use your configured keywords instead of the defaults.

---

## What Happens on ZIP Import

When you upload a ZIP to **SW Units → Upload Code**:

1. Each supported source file (`.c`, `.cpp`, `.h`, `.py`, `.js`, `.ts`, `.java`, `.rs`, …) is extracted.
2. The parser reads the first 30 lines and extracts all recognized keywords.
3. The tool matches the file by `file_path`. If a match is found and the content hash changed, the unit is flagged as **Changed** and a version snapshot is saved.
4. Parsed values (`@unit`, `@name`, `@type`, `@asil`, `@sdd`, `@req`) are used to **auto-populate** the SW unit fields:
   - `@unit` → Unit Code
   - `@name` → Name
   - `@type` → Unit Type
   - `@asil`, `@sdd`, `@req`, `@author` → stored in Description
5. A summary shows: **X new · Y changed · Z unchanged**

---

*Last updated: 2026-04-30 — Safety PLM v0.9.x*
