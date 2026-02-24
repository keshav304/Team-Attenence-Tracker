# dhSync — Comprehensive Product Documentation

## 1. Application Overview

### Purpose

dhSync is an internal web application designed for teams to plan, track, and share daily work location visibility. It enables every team member to declare whether they will be working from the office, working from home, or on leave on any given workday. This information is shared with the entire team through a unified calendar view, providing real-time situational awareness of who is where on any given day.

### Problem It Solves

In hybrid and remote-first work environments, teams need a simple, centralized way to know where each person will be on a particular day. Without such a tool, managers and colleagues lack visibility into availability, making office coordination, meeting planning, and resource allocation difficult. dhSync eliminates this gap by giving every team member a shared calendar that aggregates individual attendance plans into one place.

### Target Users

dhSync is intended for small to medium-sized internal teams within an organization. There are two categories of users: regular team members who manage their own attendance calendar, and administrators who oversee the entire team, manage user accounts, configure holidays, and access analytics dashboards.

### Core Concepts

The system revolves around the following core concepts:

- **Entries**: An entry is a record that a specific user has explicitly set a particular status (Office or Leave) on a specific date. Entries are the only persisted attendance records.
- **Work From Home (WFH)**: WFH is the default, implicit status for any working day where no entry exists. It is never stored in the database; it is derived at query time.
- **Working Days**: Any calendar day that is not a weekend (Saturday or Sunday) and not a designated organizational holiday is considered a working day.
- **Holidays**: Organization-wide non-working days configured by administrators. These are separate from personal leave.
- **Templates**: Reusable presets that a user can define to quickly apply a frequently-used combination of status, time window, and note to selected dates.

---

## 2. User Roles and Permissions

### Roles

dhSync defines exactly two roles: **Member** and **Admin**.

### Member Role

A member is a standard user of the system. Members have the following capabilities:

- View the Team Calendar showing all active team members' statuses for any month.
- View and edit their own personal calendar (My Calendar).
- Set their own daily status to Office, Leave, or WFH for dates within the allowed editing window.
- Add optional notes (up to 500 characters) and optional active hour time windows to their entries.
- Use bulk operations to set status across multiple dates at once.
- Create, manage, and apply personal templates for quick status entry.
- Use advanced features such as Repeat Pattern, Copy From Date, and Copy Week/Month.
- View the Today's Status widget showing who is in the office, on leave, or working from home today.
- Search and filter the team calendar by name, email, or status.
- Change their own display name and password through the Profile page.

Members are restricted in the following ways:

- They cannot edit other users' entries on the Team Calendar; cells for other users are read-only for members.
- They can only edit their own entries within the allowed date window (see Editing Rules below).
- They cannot access the administrative pages: Manage Users, Manage Holidays, Insights, or Employee Insights.
- They cannot create, update, or delete holidays.
- They cannot create, update, or delete other user accounts.
- They cannot export CSV attendance reports.

### Admin Role

An admin has all the capabilities of a member, plus additional administrative privileges:

- Full access to the Manage Users page where they can create new users, edit user details (name, email, role, active status), reset passwords, deactivate users, and delete users along with all their entries.
- Full access to the Manage Holidays page where they can create, edit, and delete organization-wide holidays.
- Full access to the Insights and Analytics page showing team-wide attendance statistics, per-employee breakdowns, office day distribution charts, and daily attendance trends.
- Full access to the Employee Insights page for viewing detailed monthly analytics for any individual employee, including a daily breakdown table.
- Ability to export monthly attendance data as a CSV file from the Insights page.
- Ability to edit any user's status on the Team Calendar by clicking their cell and changing it through an inline popover.
- No date restrictions on editing — admins can edit entries for any date, past or future, without the member editing window constraint.
- An admin cannot delete their own account through the admin panel to prevent accidental lockout.

### Visibility Rules

- All authenticated users (both members and admins) can see the Team Calendar with every active team member's daily status.
- The Today's Status widget is visible to all authenticated users.
- Admin-only pages (Manage Users, Manage Holidays, Insights, Employee Insights) are hidden from the navigation bar for non-admin users and are inaccessible via direct URL — the routing redirects them away.
- Inactive users cannot log in. Their entries remain in the system but are not shown in analytics or team views because they are excluded from active user queries.

---

## 3. Calendar and Presence System

### Personal Calendar (My Calendar)

The My Calendar page displays a month-grid calendar for the currently logged-in user. Each cell represents a single day and shows the user's status for that date using color coding and emoji icons. The calendar shows one month at a time, and users can navigate backward or forward through months using arrow buttons, or jump to the current month using a "Today" button.

### Team Calendar

The Team Calendar page displays a tabular matrix with team members listed as rows and calendar days listed as columns. Each cell shows the status of that team member on that date. The calendar shows one month at a time. Column headers display the day of the week abbreviation and date number. A summary row at the top aggregates the count of users in each status (office, leave, WFH) for each date.

### Status Types

The system recognizes the following daily status types:

- **Office**: The user is working from the physical office on that day. Stored as an entry with status "office". Displayed with a blue background and a building emoji icon.
- **Leave**: The user is on personal leave or time off on that day. Stored as an entry with status "leave". Displayed with an orange background and a palm tree emoji icon.
- **WFH (Work From Home)**: The user is working remotely from home on that day. This is the default status. WFH is never stored in the database. A working day with no entry record is implicitly treated as WFH. Displayed with a light green background and a house emoji icon.
- **Holiday**: An organization-wide non-working day configured by an administrator. Holidays are displayed with a purple background and a celebration emoji icon. Users cannot set their own status on holidays because holidays are not working days.
- **Weekend**: Saturday and Sunday are non-working days. Weekend cells are visually muted and non-interactive. No status can be set for weekends.

### Default State Behavior

When a new month is loaded and no entries exist for a user on any working day in that month, all working days implicitly default to WFH. The system does not create database records for WFH. Instead, at display time, any working day without a corresponding entry is rendered as WFH. This means that setting a day to WFH is accomplished by deleting the existing entry for that date, if one exists.

### How Statuses Are Stored or Derived

Only two statuses are persisted in the database: "office" and "leave". Each entry record contains a user ID, a date string in YYYY-MM-DD format, and a status field set to either "office" or "leave". There is a unique compound index on user ID and date, ensuring that only one entry can exist per user per date.

WFH is derived at query time. When the system fetches entries for a user in a date range, any working day that does not have a corresponding entry record is treated as WFH by the frontend. The backend does not inject WFH records into responses.

### Working Day Determination

A working day is any calendar date that satisfies both of the following conditions:

1. It is not a Saturday or Sunday (the day-of-week must be Monday through Friday).
2. It does not fall on a date that is configured as an organizational holiday.

All date calculations use the YYYY-MM-DD string format. Weekend detection is based on the JavaScript Date object's getDay() method, where 0 is Sunday and 6 is Saturday.

### Weekend Handling

Saturdays and Sundays are always treated as non-working days. Weekend cells on both the personal and team calendars are visually distinguished with muted styling and are not clickable. No entries can be created for weekend dates. The system does not allow setting or overriding weekend behavior.

### Holiday Handling

Holidays are organization-wide non-working days managed exclusively by administrators. Each holiday has a date (in YYYY-MM-DD format) and a descriptive name (for example, "Republic Day" or "Christmas"). Only one holiday can exist per date.

Holiday dates are excluded from the working day count in all statistics and analytics. On the calendar, holiday cells are displayed with a distinct purple style and the holiday name is shown in a tooltip. Users cannot edit their status on a holiday date because it is not a selectable day. If a user previously set an entry on a date that later becomes a holiday, that entry still exists in the database but is excluded from working day stats calculations.

---

## 4. Editing Rules

### Member Editing Window

Regular members can only create, update, or delete their own entries within a specific date range. This range is defined as:

- **Earliest allowed date**: The first day of the current calendar month. For example, if today is February 20, 2026, the earliest editable date is February 1, 2026.
- **Latest allowed date**: 90 calendar days from today. For example, if today is February 20, 2026, the latest editable date is May 21, 2026.

Any date outside this window is locked for members. Locked dates appear visually dimmed on the calendar and are not clickable. When a member hovers over a locked date, a tooltip explains why it is locked, such as "Before current month — read only" or "Beyond 90-day planning window — read only".

### Past Date Restrictions for Members

Members can edit dates earlier in the current month, even if those dates are in the past. For instance, on February 20, a member can still change their entry for February 3 of the same month. However, a member cannot edit dates in any previous month. January 31 would be locked if today is in February.

### Future Planning Window

Members can plan their status up to 90 days into the future. This allows advance planning for office attendance, upcoming leave, and schedule coordination. The 90-day limit is enforced both on the client (dates beyond this range are non-selectable) and on the server (API requests for out-of-range dates are rejected with a 403 error).

### Admin Overrides

Administrators are not subject to any date restrictions. An admin can edit entries for any user on any date — past or future — with no limitations. The server bypasses the member date window check when the requesting user has the admin role. This allows administrators to correct historical data or make adjustments as needed.

### Month Boundary Behavior

When a user navigates to a previous month on My Calendar, dates in that month that fall before the start of the current calendar month will appear locked for members. When navigating to a future month, dates beyond the 90-day planning window will appear locked. Only dates within the allowed window remain clickable and editable.

### Server-Side Enforcement

All editing rules are enforced on the server. Even if a client sends a request to modify a date outside the allowed range, the server validates the date against the member's allowed window and returns an error if the date is not permitted. Admin requests bypass this check.

---

## 5. Daily Status Definitions

### Office

A day is classified as "Office" when the user has an entry record with the status field set to "office" for that date. This means the user has declared that they will be physically present in the office on that day. Office days are counted toward the office attendance statistics. They are displayed on calendars with a blue visual treatment.

### Leave

A day is classified as "Leave" when the user has an entry record with the status field set to "leave" for that date. This indicates the user is on personal leave, vacation, sick leave, or any other form of time off. Leave days are counted toward the leave statistics. They are displayed on calendars with an orange visual treatment.

### WFH (Work From Home)

A working day (not a weekend and not a holiday) is classified as "WFH" when no entry record exists for that user on that date. WFH is the default status — it does not need to be explicitly set. When a user explicitly sets a day to WFH through the interface, the system deletes any existing entry for that date, reverting it to the implicit WFH default. WFH days are computed by subtracting the number of office days and leave days from the total working days in a given period.

### Holiday

A day is classified as "Holiday" when an administrator has created a holiday record for that date. Holidays are not a user-set status; they are organization-wide designations. Holiday days are excluded from working day counts and are not counted toward any user's attendance statistics.

### Weekend

Saturday and Sunday are classified as "Weekend." Weekend days are never working days and cannot have any attendance status assigned to them. They are excluded from all calculations and statistics.

### Partial Day / Active Hours

Any entry (office or leave) may optionally include an active hours time window consisting of a start time and an end time in 24-hour HH:mm format. Both start time and end time must be provided together — specifying only one is not allowed. The end time must be after the start time. This feature allows users to indicate that they will be in the office only during specific hours, such as 09:30 to 15:00, enabling colleagues to know when a person will be available. Entries with a time window are counted as "partial days" in analytics.

### Notes

Any entry may optionally include a free-text note of up to 500 characters. Notes can contain information such as "Doctor appointment in the morning," "Half day," or "Working from client site." Notes are visible in tooltips when hovering over calendar cells and are counted in analytics as entries with notes.

---

## 6. Analytics and Insights

### Overview

dhSync provides two analytics pages, both accessible only to administrators: the Team Insights page and the Employee Insights page.

### Team Insights Page

The Team Insights page presents aggregated attendance analytics for the entire team for a selected month and year. Administrators can navigate between months using forward and backward buttons or by selecting a month and year from dropdown selectors.

#### Summary Cards

The page displays the following summary metrics in card format:

- **Employees**: The total number of active employees in the system.
- **Working Days**: The total number of working days in the selected month (excluding weekends and holidays).
- **Total Office Days**: The sum of office days across all employees for the selected month.
- **Total Leave Days**: The sum of leave days across all employees for the selected month.
- **Total WFH Days**: The sum of WFH days across all employees for the selected month.
- **Avg Office / Day**: The average number of employees in the office per working day, calculated as total office days divided by total working days.
- **Most Popular Day**: The weekday (Monday through Friday) with the highest cumulative count of office entries across all employees.
- **Least Popular Day**: The weekday with the lowest cumulative count of office entries across all employees.

#### Office Day Distribution Chart

A bar chart showing the total number of office entries for each weekday (Monday through Friday). This reveals patterns in which days of the week the team prefers to be in the office.

#### Daily Office Attendance Trend

A bar chart showing the count of employees in the office for each working day of the selected month. Each bar represents one working day, with the date number shown below and the count shown above.

#### Holidays List

If holidays exist in the selected month, they are displayed in a section listing each holiday's name and date.

#### Per-Employee Breakdown Table

A sortable table where each row represents one employee and columns display:

- Name (with an admin badge if the employee is an admin)
- Office Days (absolute count)
- Leave Days (absolute count)
- WFH Days (absolute count)
- Office Percentage (office days as a percentage of total working days, color-coded: green for 60% or above, amber for 30-59%, red for below 30%)
- Leave Percentage (color-coded: green for 10% or below, amber for 11-30%, red for above 30%)
- WFH Percentage
- Partial Days (entries with a time window)
- Notes Count (entries with a note)
- Working Days (the effective working days for this employee, accounting for when they joined)

The table is sortable by clicking on any column header. Clicking the same column header toggles between ascending and descending order.

### How Statistics Are Computed

#### Working Day Calculation

The system generates the list of all dates in the selected month, then excludes any date that falls on a Saturday or Sunday and any date that is a registered holiday. The remaining dates are the working days. The count of these dates is the total working days for that month.

#### Office Count

For each employee, the system counts the number of working days where the employee has an entry with status "office." This counts only entries that fall on actual working days — entries on holidays or weekends are excluded.

#### Leave Count

For each employee, the system counts the number of working days where the employee has an entry with status "leave." Again, only entries on actual working days are counted.

#### WFH Count

WFH is calculated as: Total Working Days minus Office Days minus Leave Days. Since WFH is not stored in the database, it is derived as the remainder.

#### Mid-Month Join Handling

If an employee's account was created partway through a month, their effective working day count is reduced to only include dates from their creation date onward. This prevents a user who joined on the 15th from having their statistics compared against a full month of working days.

### Employee Insights Page

The Employee Insights page provides detailed monthly analytics for a single selected employee. An administrator selects an employee from a searchable dropdown, then views that employee's data for the chosen month and year.

#### User Summary Cards

The page displays the following cards for the selected employee:

- Total Working Days for the selected month
- Office Days (absolute count and percentage)
- Leave Days (absolute count and percentage)
- WFH Days (absolute count and percentage)
- Partial Days (entries with time windows)
- Notes Count (entries with notes)

#### Status Distribution Chart

A horizontal bar chart showing the count of each status type (Office, Leave, WFH, Holiday, Weekend, Not Joined) across all days of the month. This provides a visual overview of how the employee's month is distributed.

#### Daily Breakdown Table

A filterable table listing every day of the selected month as a row. Each row shows:

- Date
- Day of the week
- Effective status (Office, Leave, WFH, Holiday, Weekend, or Not Joined)
- Start time (if applicable)
- End time (if applicable)
- Note (if any)
- Holiday name (if the day is a holiday)

The table can be filtered by status using toggle buttons at the top, allowing the administrator to quickly see only office days, only leave days, and so on.

---

## 7. Filters and Search Behavior

### Team Calendar Filtering

The Team Calendar page includes a combined search and filter bar with the following capabilities:

#### Name and Email Search

A text input labeled "Search by name or email" performs real-time, case-insensitive filtering. As the user types, the team member list is instantly narrowed to only those members whose name or email address contains the search string. The search has a clear button (✕) to reset it.

#### Status Filter on a Specific Date

The status filter consists of two parts used together:

1. A date picker that allows the user to select a specific date within the displayed month.
2. A segmented button group with four options: All, Office (🏢), Leave (🌴), and WFH (🏠).

When a status filter other than "All" is selected and a date is specified, the team list is further narrowed to only members who have the matching effective status on that date. For example, selecting "Office" on "2026-02-18" will show only team members with an office entry on February 18.

#### Filter Feedback

The filter bar shows a count of matched members versus total members (for example, "5/12"). A "Clear filters" link appears when any filter is active, allowing the user to reset all filters with one click.

### Employee Insights Page Filtering

The daily breakdown table on the Employee Insights page includes status filter buttons that allow filtering the day list by a specific status. This helps administrators quickly see, for instance, only the leave days for a given employee.

### Insights Page Sorting

The per-employee table on the Insights page supports column sorting. Clicking a column header sorts the table by that column. Clicking the same header again reverses the sort direction. Sort indicators (arrow icons) show the current sort column and direction.

---

## 8. Data Export Features

### CSV Export

The Team Insights page includes a CSV export feature accessible only to administrators.

#### How to Export

A button labeled "Export CSV" is displayed in the header area of the Insights page, next to the month and year selectors. Clicking this button triggers an immediate download of a CSV file containing the monthly attendance data for all active employees.

#### Scope of Export

The export covers all active employees for the selected month and year. It is not influenced by any sort order or filter applied to the on-screen table.

#### Data Included

Each row in the CSV file represents one employee and contains the following columns:

- Name
- Email
- Working Days (total effective working days for that employee)
- Office Days (absolute count)
- Leave Days (absolute count)
- WFH Days (derived count)
- Office % (percentage rounded to the nearest whole number)
- Leave % (percentage rounded to the nearest whole number)
- WFH % (percentage rounded to the nearest whole number)

#### File Naming

The downloaded file is named using the pattern "attendance-Mon-YYYY.csv" where "Mon" is the three-letter month abbreviation and "YYYY" is the year. For example, "attendance-Feb-2026.csv".

#### Permissions

Only administrators can access the CSV export. The server rejects export requests from non-admin users.

#### Loading State

While the export is in progress, the button shows a spinning animation and the text "Exporting…" to indicate that the file is being generated and downloaded.

---

## 9. Operational Awareness Features

### Today's Status Widget

The Team Calendar page includes a collapsible "Today's Status" widget displayed prominently above the team calendar matrix. This widget provides an at-a-glance view of where everyone on the team is today.

#### Widget Behavior

The widget header shows a summary line with the counts of employees in each category: for example, "3 in office · 1 on leave · 8 WFH." It also indicates special day conditions such as weekends ("Weekend") or holidays (showing the holiday name).

The widget body is divided into three columns:

- **In Office**: Lists the names of team members with an "office" entry for today. Each name is shown with a blue avatar initial and, if available, the person's active hours time window.
- **On Leave**: Lists the names of team members with a "leave" entry for today. Each name is shown with an orange avatar initial and, if available, the associated note.
- **WFH**: Lists the names of team members with no explicit entry for today (defaulting to WFH). Each name is shown with a green avatar initial.

#### Collapsible

The widget can be collapsed by clicking the header, reducing it to just the summary line. Clicking again expands it to show the full categorized lists. This allows users to conserve screen space when they do not need the detailed view.

#### Refresh

A refresh button within the widget header allows the user to manually re-fetch the current day's status data without refreshing the entire page.

#### Weekend and Holiday Behavior

If today is a weekend, the widget displays a message indicating it is the weekend. If today is a holiday, the widget displays the holiday name. In both cases, the categorized employee lists are not shown because attendance tracking is not applicable.

---

## 10. Announcement or Communication Features

dhSync does not include any built-in announcement, messaging, or communication features. The system is focused solely on attendance tracking and work location visibility.

---

## 11. User Interface Behavior

### Theme System

dhSync supports both light and dark color themes. A toggle button (displaying a sun icon for light mode and a moon icon for dark mode) is available in the header navigation bar. The selected theme preference is persisted in the browser's local storage and is restored on subsequent visits. To prevent a flash of the wrong theme on page load, the theme is applied at the earliest possible moment before the page renders.

### Date Selection on My Calendar

The My Calendar page supports three modes of date selection:

1. **Single click**: Clicking a single editable date opens a detail modal for that date where the user can set the status, active hours, and note.
2. **Drag selection**: Pressing and holding the mouse button on an editable date, then dragging across multiple dates and releasing, selects a contiguous range of editable dates. Weekend and holiday dates within the range are automatically excluded. The drag selection is indicated by a visual ring highlight on selected cells.
3. **Ctrl+Click (multi-select)**: Holding the Control key (or Command key on macOS) and clicking individual dates toggles each date's selection state independently, allowing non-contiguous multi-selection.

### Clearing Selection

Selected dates on My Calendar are cleared automatically when the user clicks anywhere outside the calendar area (which includes the toolbar, bulk action bar, calendar grid, and templates panel). Alternatively, a "Clear selection" button appears in the toolbar when dates are selected.

### Navigation Behavior

Both the My Calendar and Team Calendar pages display one month at a time. Users navigate between months using left arrow and right arrow buttons flanking the month display. A "Today" button jumps directly to the current month.

The Insights and Employee Insights pages also allow month-by-month navigation, supplemented by month and year dropdown selectors for quick jumps to any available period.

### Read-Only vs. Editable States

On My Calendar, a cell is editable if it meets all of the following conditions:

- The date is not a weekend.
- The date is not a holiday.
- The user is an admin, OR the date falls within the member editing window (start of current month through 90 days from today).

Non-editable cells are visually dimmed with reduced opacity and are not interactive. Hovering over a locked cell shows a tooltip explaining why it is locked.

On the Team Calendar, a cell is editable only if:

- The date is not a weekend.
- The date is not a holiday.
- The user is viewing their own row, OR the user is an admin.
- For non-admin users viewing their own row, the date must fall within the member editing window.

### Inline Editing on Team Calendar

When an editable cell is clicked on the Team Calendar, an inline popover appears below the cell. This popover allows the user to set the status (Office, Leave, or WFH), add or modify active hours, and add or edit a note. The popover includes a Save button to commit changes and a Cancel button to dismiss. After saving, the local state updates immediately without requiring a full page reload.

### Day Detail Modal on My Calendar

When a single date is clicked on My Calendar (without drag selection), a full-screen overlay modal appears. This modal shows the full date in a human-readable format, the current status, and provides controls for:

- Selecting a status (Office, Leave, or WFH) via toggle buttons.
- Setting an optional time window with two time picker inputs.
- Adding an optional note in a textarea with a visible character counter.
- Saving or canceling the changes.

The modal includes contextual warnings, such as alerting the user if the date is a holiday or if saving will overwrite an existing entry.

### Bulk Action Toolbar

When one or more dates are selected on My Calendar, a Bulk Action Toolbar appears. This toolbar allows the user to:

- Choose a status (Office, Leave, or Clear/WFH) to apply to all selected dates.
- Optionally set a time window and note to apply uniformly.
- See contextual warnings (such as overwriting existing entries or setting leave on holidays).
- Apply the bulk action with a single click.

### Templates Panel

A side panel on the right of My Calendar (visible on large screens) displays the user's saved templates. Users can:

- Create a new template by specifying a name, status, optional time window, and optional note.
- Apply an existing template to the currently selected dates.
- Delete templates they no longer need.

### Modals for Advanced Operations

My Calendar includes three modal dialogs for advanced operations:

1. **Copy From Date**: Copies the status, time window, and note from a chosen source date to all currently selected target dates.
2. **Repeat Pattern**: Applies a chosen status to specific days of the week (for example, every Monday and Wednesday) across a specified date range.
3. **Copy Week/Month**: Copies entries from a previous week or month to a new period. Includes presets for "Last Week → This Week" and "Last Month → This Month," as well as a custom range option.

### Conflict Warnings

The system displays visual warnings in several situations:

- Setting a leave entry on a date that is also a holiday.
- Setting a time window on a leave day (flagged as unusual).
- End time being before or equal to the start time.
- A bulk action that would overwrite existing entries.

These warnings are informational and do not block the action. They appear as labeled badges or inline messages in amber coloring.

### Toast Notifications

All user actions that modify data result in feedback via toast notifications. Successful operations show a green success toast; failures show a red error toast. Toasts appear briefly at the top of the screen and dismiss automatically.

---

## 12. Data Model Concepts (High Level)

### Persisted Entities

The following data entities are stored in the database:

#### User

Represents a person who can log in to the system. Each user has a name, email address, hashed password, role (member or admin), and an active/inactive flag. Users have timestamps indicating when they were created and last updated. Email addresses must be unique across all users.

#### Entry

Represents a user's declared status for a specific date. Each entry belongs to one user and is associated with one date. An entry has a status of either "office" or "leave." An entry may optionally include a start time, end time, and note. Only one entry can exist per user per date, enforced by a unique compound index.

#### Holiday

Represents an organization-wide non-working day. Each holiday has a date and a human-readable name. Only one holiday can exist per date. Holidays are managed exclusively by administrators.

#### Template

Represents a user-created reusable preset for quick entry creation. Each template belongs to one user and has a unique name (per user), a status of "office" or "leave," and optional start time, end time, and note fields. Templates are personal — each user has their own set of templates.

### Derived Data

The following data is computed dynamically at query time and is not stored:

- **WFH status**: Any working day without an entry is treated as WFH.
- **Working day lists**: Generated by iterating through the days of a month and excluding weekends and holidays.
- **Attendance statistics**: Office counts, leave counts, WFH counts, percentages, and averages are all computed from the raw entries and working day lists at the time of the request.
- **Team availability summaries**: The per-date counts of how many users are in office, on leave, or WFH are computed on each request.
- **Today's status**: The categorized lists of who is where today are computed fresh on each request.

### Relationships Between Entities

- Each **Entry** belongs to exactly one **User** through a user ID reference.
- Each **Template** belongs to exactly one **User** through a user ID reference.
- **Holidays** are independent of users — they apply globally to the entire organization.
- There is no direct relationship between Entries and Holidays. The exclusion of holiday dates from working day calculations is performed at query time through set operations.

---

## 13. Common User Tasks

### Registering a New Account

A new user navigates to the registration page, enters their name, email address, and a password (minimum 6 characters), and clicks "Register." Upon successful registration, the user is automatically logged in and redirected to the Team Calendar.

### Logging In

An existing user navigates to the login page, enters their email address and password, and clicks "Sign In." Upon successful authentication, the user is redirected to the Team Calendar. Invalid credentials result in an error message.

### Setting Your Status for a Single Day

On My Calendar, the user clicks the desired date cell. A modal appears showing the date, three status options (Office, Leave, WFH), optional time window inputs, and an optional note field. The user selects the desired status, optionally fills in the time and note, and clicks "Save." If they select WFH and an entry already exists, the entry is deleted to revert to the implicit default.

### Setting Status for Multiple Days at Once

The user selects multiple dates on My Calendar using drag selection or Ctrl+Click. Once dates are selected, the Bulk Action Toolbar appears. The user chooses a status (Office, Leave, or Clear), optionally adds a time window and note, and clicks "Apply." The status is applied to all selected dates in one operation.

### Using Repeat Pattern

The user clicks the "Repeat Pattern" button in the toolbar. A modal appears where they select a status, choose one or more days of the week (for example, Monday and Wednesday), specify a date range, and optionally set a time window and note. Clicking "Apply Pattern" creates entries for all matching dates within the range.

### Copying Last Week's Plan to This Week

The user clicks the "Copy Week/Month" button in the toolbar. A modal appears with presets. The user selects "Last Week → This Week" and clicks "Copy." The system replicates entries from the previous Monday-Friday period to the current week.

### Using Templates

On the Templates side panel, the user creates a new template by entering a name, selecting a status, and optionally setting a time window and note. To use the template, the user first selects dates on the calendar, then clicks "Apply" on the desired template. The template's settings are bulk-applied to all selected dates.

### Viewing Team Availability for Today

On the Team Calendar page, the user views the Today's Status widget at the top. It shows three columns listing team members categorized as In Office, On Leave, or WFH for the current day, along with their times and notes where available.

### Searching for a Team Member

On the Team Calendar page, the user types a name or email fragment into the search box. The team member list filters in real time to show only matching members.

### Viewing Team Analytics (Admin)

An administrator navigates to the Insights page. They select a month and year, then view summary cards, day-of-week distribution charts, daily attendance trends, and the per-employee breakdown table. They can sort the table by any column.

### Exporting Attendance Data (Admin)

On the Insights page, an administrator clicks the "Export CSV" button. A CSV file is immediately downloaded to their computer containing the per-employee attendance breakdown for the selected month.

### Viewing Individual Employee Analytics (Admin)

An administrator navigates to the Employee Insights page, searches for and selects an employee from the dropdown, and views that employee's detailed monthly analytics including summary cards, status distribution chart, and a daily breakdown table.

### Managing Holidays (Admin)

An administrator navigates to the Manage Holidays page, clicks "Add Holiday," enters a date and name, and saves. The holiday immediately affects working day calculations and calendar displays across the application. Existing holidays can be edited or deleted from the same page.

### Managing Users (Admin)

An administrator navigates to the Manage Users page where they can:

- Create new user accounts by specifying a name, email, password, and role.
- Edit existing users' names, emails, roles, and active status.
- Reset a user's password.
- Deactivate a user (preventing them from logging in without deleting their data).
- Delete a user and all their associated entries permanently.

### Changing Your Name

A user navigates to the Profile page, edits the name field, and clicks "Update Name." The change is saved and reflected across the application.

### Changing Your Password

A user navigates to the Profile page, enters their current password, types and confirms a new password (minimum 6 characters), and clicks "Change Password."

---

## 14. System Constraints and Rules

### Authentication Requirements

All pages except the Login and Registration pages require authentication. Unauthenticated requests to the API are rejected with a 401 status code. Authentication is token-based using JSON Web Tokens (JWT). Tokens are stored in the browser's local storage and included in API request headers.

### Inactive User Restrictions

When a user account is deactivated by an administrator, the user can no longer log in. Existing tokens for deactivated users are rejected upon the next API request because the server verifies user active status on every authenticated request.

### Entry Uniqueness

Only one entry can exist per user per date. Attempting to create a second entry for the same user and date will update the existing entry rather than creating a duplicate, due to the upsert behavior used by the system.

### Status Values

The only valid status values that can be stored in the database are "office" and "leave." Attempting to set any other value through the API results in a validation error. The "clear" status used in bulk operations is a client-side concept that translates to deleting the entry (reverting to WFH).

### Time Window Validation

If a time window is provided, both the start time and end time must be specified together. Providing only one is an error. The end time must be strictly after the start time. Times must be in HH:mm 24-hour format (for example, "09:30" or "17:00").

### Note Length Limit

Notes on entries and templates are limited to a maximum of 500 characters. The frontend enforces this limit in the input field, and the server validates it as well.

### Template Name Uniqueness

Template names must be unique per user. A user cannot create two templates with the same name. Attempting to do so results in a conflict error.

### Holiday Date Uniqueness

Each date can have at most one holiday. Attempting to create a holiday on a date that already has one results in a conflict error.

### Self-Deletion Prevention

An administrator cannot delete their own account through the admin user management interface. This prevents accidental lockout of the last administrative account.

### Deletion Cascades

When a user is deleted by an administrator, all entries associated with that user are also deleted from the database. Templates belonging to that user are implicitly orphaned (the template collection does not cascade-delete, but templates for a deleted user are inaccessible).

### Bulk Operation Limits

Bulk operations (bulk set, repeat pattern, copy range) process dates sequentially on the server. Dates that fall outside the allowed editing window for a member are skipped and reported as "skipped" in the response. The response includes per-date success/failure details so the user can see which dates were updated and which were not.

### Input Sanitization

Notes and other text inputs are sanitized to strip HTML tags and script content before being stored, providing basic protection against cross-site scripting in user-supplied text.

### Date Format

All dates throughout the system are represented as strings in YYYY-MM-DD format. This format is used in the database, API requests, API responses, and client-side logic. Month identifiers use YYYY-MM format.

### Password Security

Passwords are hashed using bcrypt with a salt round of 12 before storage. Plaintext passwords are never stored or returned in API responses. The password field is excluded from all user data serialization by default.

### Token Expiration

JWT authentication tokens have an expiration time configured in the server settings. Once a token expires, the user must log in again to obtain a new token.

### Mobile Responsiveness

The application layout adapts to different screen sizes. On smaller screens, the header navigation switches from a horizontal bar to a horizontally scrollable row. The templates side panel on My Calendar is hidden on smaller screens. The Team Calendar table supports horizontal scrolling when the content overflows the available width.
