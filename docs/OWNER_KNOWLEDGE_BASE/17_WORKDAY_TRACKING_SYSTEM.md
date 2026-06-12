# Workday Tracking System V1

> **Status:** Future Operational Module — APPROVED CONCEPT, NOT IMPLEMENTED
> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

---

## Objective

Provide Upper Management and Sales Managers with operational visibility into field activity.

### Purpose

- Know who is currently working.
- Know where field employees are.
- Know how workday time was spent.
- Reduce fake visits.
- Verify actual field activity.
- Support weak internet environments.

This system is independent from Visit Management.

---

## TRACKING_MODE

Configurable from Upper Management settings.

### 1. OFF

No tracking. No workday monitoring.

### 2. VISITS_ONLY

- Tracking starts on Start Visit.
- Tracking stops on End Visit.

### 3. WORKDAY

- Tracking starts on Start Workday.
- Tracking stops on End Workday.

### 4. WORKDAY_PLUS_VISITS

- Workday tracking active all day.
- Visit markers attached to timeline.
- Full operational visibility.

**Preferred Owner Mode:** WORKDAY_PLUS_VISITS

---

## EMPLOYEE_WORKDAY_FLOW

1. Employee opens app.
2. Button: **START WORKDAY**
3. System records:
   - Employee
   - Start Time
   - Start Location
   - Device Status
4. Employee status becomes: **ACTIVE**
5. Employee performs work. System collects location points.
6. Button: **END WORKDAY**
7. System records:
   - End Time
   - End Location
   - Total Duration
8. Status becomes: **OFF DUTY**

---

## UPPER_MANAGEMENT_CONTROL_CENTER

### Navigation

Menu: Field Operations → Submenu: Workday Tracking

### Control Panel Settings

| Setting | Options |
|---------|---------|
| Tracking Mode | OFF, VISITS_ONLY, WORKDAY, WORKDAY_PLUS_VISITS |
| Tracking Interval | 30 Seconds, 1 Minute, 2 Minutes, 5 Minutes |
| Offline Sync | Enabled, Disabled |
| Retention Policy | 30 Days, 60 Days, 90 Days, 180 Days |

**Owner Preference:** Retention = 90 Days

---

## LIVE_OPERATIONS_SCREEN

### Visibility

- Upper Management: Full Access
- Sales Managers: Own Team Only

### Displayed Information

| Field | Example |
|-------|---------|
| Active Employees | — |
| Current Location | — |
| Last Update | 10:42 |
| Workday Duration | 4h 15m |
| Battery Percentage | 68% |
| GPS Status | — |

---

## EMPLOYEE_DAY_ANALYSIS

### Access Path

Employees → Employee Name → Workday Analysis

### Summary Cards

- Start Time
- End Time
- Work Duration
- Visits Count
- Orders Count
- New Customers
- Net Sales
- Distance Traveled

---

## WORKDAY_TIMELINE

Chronological view of events:

```
08:12   Start Workday
08:47   Start Visit
09:06   End Visit
10:15   Order Created
11:20   Start Visit
11:55   End Visit
...
```

---

## LIVE_MAP

### Map Elements

| Element | Color |
|---------|-------|
| Start Point | Green |
| Visit | Blue |
| Long Stop | Orange |
| End Point | Red |

- Travel path shown between points.
- Maps rendered dynamically (no stored map images).

---

## LONG_STOP_DETECTION

System highlights unusual stops for management review.

### Example

```
Stopped:   52 Minutes
Location:  Tanta
Time:      12:03 → 12:55
```

- Purpose: Management review only.
- No automatic penalties.

---

## DAY_REPLAY

### Access

Button: Replay Day

Management can replay movement history.

### Playback Speeds

1x, 2x, 5x, 10x

---

## OFFLINE_SUPPORT

### Behavior

If internet becomes unavailable:
- Location points stored locally.

When internet returns:
- Unsent points uploaded automatically.

No movement data should be lost due to weak connectivity.

---

## DATA_STORAGE

### Stored Fields

- Latitude
- Longitude
- Timestamp
- Employee
- Workday Session

### NOT Stored

- Map images (rendered dynamically)

---

## PERMISSIONS

| Role | Access |
|------|--------|
| Upper Management | Full Access |
| Sales Manager | Own Team Only |
| Sales Representatives | Own Workday Only (no access to others) |

---

## RELATIONSHIP TO EXISTING MODULES

The tracking mode selection in Administration settings is managed from `09_ADMINISTRATION_RULES.md` (Upper Management administration responsibilities).

Visit-related events (Start Visit, End Visit) are linked to the visit system documented in `06_VISIT_RULES.md`.

This system is independent from Visit Management.

---

## FUTURE_EXPANSION

Optional future features (NOT required for V1):

- Geofencing
- Territory Compliance
- Route Optimization
- Attendance Integration
- AI Activity Analysis
- Productivity Scoring

---

*End of 17_WORKDAY_TRACKING_SYSTEM.md*
