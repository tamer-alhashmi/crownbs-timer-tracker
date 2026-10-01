This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Global chat

The global floating chat and notification bell are mounted from the root layout. Chat API routes enforce contact permissions using the live `users.role` value; all message and private attachment reads/writes go through those routes. Set `SUPABASE_SERVICE_ROLE_KEY` (already used by trusted server operations) and optionally `CHAT_SESSION_SECRET` to a high-entropy secret dedicated to signing chat session proofs. Users must sign in again after deployment to receive the proof cookie. Do not expose either secret to the browser.

Apply `supabase/migrations/20261001_chat_system.sql` to create the `public.messages` table and private `chat_attachments` bucket. The migration also enables RLS, adds chat query indexes, and enables Realtime publication for `messages`. Chat attachments are limited to 12 MB and images, PDFs, and Word documents. The API stores attachment object paths in `messages.attachment_url` and authorizes each signed download against its conversation.

## Admin property setup

Apply `supabase/migrations/20261001_property_setup.sql` to ensure properties have generated UUIDs, creation timestamps, owner/manager assignments, locations, and active status. Administrators can manage properties and services from the dashboard's **Property & services** section.

## Payroll task management

Apply `supabase/migrations/20261002_payroll_task_management.sql` before deploying payroll task editing. It adds per-work-log cost overrides and audited soft deletion; deleted tasks are excluded from payroll totals while their records remain available for audit. Work-log changes are broadcast through Supabase Realtime to refresh open dashboards.

## Management interventions and service controls

Apply `supabase/migrations/20261003_management_interventions.sql` to enable audited shift clock-outs and active-task completion/cancellation, add the management override audit log, and publish shift changes through Supabase Realtime. Manager and Owner service controls use the existing `services_config` role policy and the `settings` feature permissions; management overrides and payroll task edits are scoped to assigned properties.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
