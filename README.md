# Crown Time Tracker & Operations Suite
### Next-Generation Multi-Tenant Workforce Management, Realtime Task Dispatch & Hospitality Operations

---

## Executive Overview
**Crown Operations Suite** is an enterprise-grade SaaS and mobile operations platform built for hospitality, facility management, and multi-property enterprises. It seamlessly bridges executive management, property owners, on-site supervisors, and field teams into one unified, real-time command center.

From automated shift logging and room cleaning tracking to granular piece-rate/hourly payroll calculations and isolated team communication, the platform eliminates operational blind spots, ensures accountability, and maximizes labor margins.

---

## Key Business Capabilities & Features

### 1. Multi-Tenant Enterprise Architecture & Six-Role Access Hierarchy
The platform enforces strict, role-scoped data isolation across all organizational levels:
* **Super Admin and Platform Admin**: Global portfolio oversight and support operations, with destructive platform controls reserved for Super Admin.
* **Property Owner**: Multi-property asset control, customized service catalog configurations, room pricing models, executive financials, and staff assignments.
* **Property Manager**: Day-to-day property orchestration, shift approvals, emergency managerial overrides, and real-time cleaner attendance tracking.
* **Housekeeping Admin**: A dedicated, property-scoped operations dashboard for room readiness, live cleaner shifts, floor inspections, task interventions, photo evidence review, and non-financial work history.
* **Field Cleaners**: Intuitive, high-speed mobile interface for clocking in/out, picking up tasks, tracking room completions, and reviewing verified earnings.

---

### 2. Live Task Dispatch & Concurrency Control
Turn task delegation from a reactive headache into an automated, proactive workflow:
* **Instant Hierarchical Task Dispatch**: Owners, Managers, and HK Admins can assign tasks down the organizational ladder directly from the **Overview Hero Card**.
* **Dynamic Property-Aware Context**: The assignment interface dynamically adapts depending on the selected service type—instantly prompting for room numbers, named sections, shift durations, or maintenance photo attachments.
* **Single Active Task Guard**: Proprietary concurrency locking prevents staff from juggling or leaving simultaneous incomplete tasks. Starting a new task strictly requires completing or formalizing the active one.
* **Realtime In-App Notification Bell**: Instant alerts dispatch directly to the assignee's mobile and desktop trays with 1-click execution (`Start Task`). Assigners receive instant live progress timestamps when work begins.

---

### 3. Comprehensive Property, Named Floors & Room Setup
Manage complex physical real estate with unmatched granularity:
* **Automated GPS & Geolocation Pinning**: Onboard new hotels or facilities instantly using one-click GPS location detection and automated reverse-geocoding.
* **Named Floors & Architectural Sections**: Define custom floor plans (e.g., *Ground Floor*, *Mezzanine*, *Executive Wing*, *Annex B*) rather than generic numeric counters.
* **Pre-Save Batch Room Configuration**:
  * Define room numbers, room categories (Standard, Deluxe, Executive Suite, Studio), and occupancy thresholds (Adults / Children capacity).
  * Configure bed distributions, custom amenity checklists, room operational statuses (Clean, In-Progress, Maintenance Required), and high-resolution photo galleries.
  * Rapid Room Batch Generator to deploy entire room inventories in seconds.
* **Room Lifecycle Management**: Property settings support room creation, edits, floor/category/status filters, atomic range generation, photo uploads, and safe archival that retains work history. Active task and cleaner selectors resolve current room names and floor labels.
* **Overlay Scroll Containment**: Open dialogs lock background scrolling while keeping modal content scrollable on touch and desktop.

Apply `supabase/migrations/20261022_room_availability_status.sql` after the existing room and housekeeping migrations to enable separate room-availability states.

---

### 4. Custom Service Catalogs & Granular Multi-Property Payroll
Replace manual spreadsheets with automated, audit-proof operational accounting:
* **Hybrid Billing Modes**: Full flexibility to charge and pay staff via:
  * **Per-Room / Piece-Rate Billing** (e.g., £8.50 per cleaned room).
  * **Hourly Shifts** (e.g., £15.00/hour for deep cleaning or night shifts).
  * **Fixed-Rate Delivery / Maintenance Tasks**.
* **Many-to-Many Property Assignments**: Assign staff and managers across multiple properties simultaneously. 
* **Per-Property Payroll Allocation**: Shift hours and completed room allowances are strictly tagged by property ID, delivering transparent earnings breakdowns per facility with zero cross-tenant contamination.
* **Audited Management Overrides & Soft Deletion**: Management retains complete authority to adjust shift hours or soft-delete erroneous work logs without compromising underlying audit compliance.

---

### 5. Secure, Tenant-Isolated Team Chat & Realtime Audio
A fully integrated, enterprise-grade communication system embedded directly into the workflow:
* **Operational Circle Isolation**: Users only see contacts relevant to their physical facilities and managerial tier—eliminating communication leaks between competing properties or unauthorized roles.
* **Universal Admin Support Channel**: Super Admins maintain global support reachability for cross-portfolio assistance.
* **Three-Tier Delivery & Read Receipts**: Visual feedback mirroring global messaging standards (Single Check = Sent; Double Gray = Delivered; Double Blue = Read).
* **Rich Media & Profile Avatars**: Send photo attachments, documents, and inspection images directly within the conversation thread.
* **Auditory & Haptic Feedback**: Synthesized, customizable sound chimes for incoming messages and urgent task notifications, with quick profile-level toggle controls.

---

### 6. Unified Settings Hub
Consolidated, clean, and centralized settings management:
* **Profile & Identity**: Update contact credentials, phone numbers, language preferences, and personal avatar photos.
* **Workforce Directory**: Add, modify, or unlink team members across the operational roles with quick 4-digit PIN generation.
* **Property & Facility Portfolio**: Manage hotels, named floor tiers, and custom service rates in one unified tabbed view.
* **Verified Executive Email**: Link an email address using a rate-limited, expiring one-time code and choose weekly or monthly role-scoped operations summaries.
* **Device Push Alerts**: Subscribe a device to task assignment alerts and manage notification permission recovery from profile settings.

Digest delivery is triggered by `POST /api/cron/digests?cadence=weekly` or `cadence=monthly` with `Authorization: Bearer $CRON_SECRET`. Schedule weekly calls on Mondays and monthly calls on the first day of the month. Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CRON_SECRET`; set `EMAIL_OTP_SECRET` to a high-entropy secret for OTP hashing. Configure Web Push with `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:...`). Apply `supabase/migrations/20261027_email_digests_and_web_push.sql` before enabling these features.

---

### 7. Native Mobile Experience (Android & Tablet Ready)
* **Progressive Native Shell**: Engineered with native hardware bridge support for Android devices.
* **Native Hardware Back Navigation**: Intelligent back-button interceptor that prioritizes closing open dialogs and chat drawers first, prompts before discarding unsaved form edits, and features a double-tap safe exit—strictly preventing accidental logouts.
* **Elevated Cleaner Workspace**: High-visibility active task banner pinned directly to the top of the mobile dashboard for immediate operational focus.

---

## Enterprise Technology Foundation
* **Frontend Architecture**: Next.js App Router, Tailwind CSS, Shadcn UI / Radix primitives.
* **Backend & Scalability**: Supabase Postgres with Row Level Security (RLS), custom RPC guards, and high-frequency WebSocket Realtime engines.
* **Mobile Runtime**: Capacitor Native Wrapper (`com.crownbs.timetracker`).
* **Security & Compliance**: Zero-trust multi-tenant isolation, tamper-proof session tokens, and encrypted private asset storage buckets.

---
**Crown Business Solutions**  
*Empowering Hospitality & Workforce Operations Worldwide.*