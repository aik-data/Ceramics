# Ceramics Fundraiser

An online gallery for the school's student ceramics fundraiser. Families browse pieces and check out. Admins are notified and send a FutureFund invoice, and the site tracks inventory and money raised.

- **Requirements:** [REQUIREMENTS.md](REQUIREMENTS.md)
- **Family site:** `site/index.html`
- **Admin portal:** `site/admin.html`

## How it's built

| Part | Where |
|------|-------|
| Website (plain HTML/CSS/JS, no build step) | `site/`, hosted on **GitHub Pages** |
| Database, logins, photo storage | **Supabase**, schema in `supabase/migrations/` |
| New-order emails | Supabase Edge Function `supabase/functions/order-notify` + Resend |
| Admin invites | Supabase Edge Function `supabase/functions/admin-users` |

**Status:** connected to the Supabase project `ceramics-fundraiser`. The schema, family login, first admin and both edge functions are set up.

**Demo mode:** if you blank out `supabaseUrl` in `site/js/config.js`, the site runs on sample data saved in your browser instead.

- Family password: `clay`
- Admin: any email, password `demo`

## Preview locally

```bash
cd site && python3 -m http.server 8000
# open http://localhost:8000  (admin: http://localhost:8000/admin.html)
```

## Publish on GitHub Pages

1. Go to **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
2. Merge this work into `main`. The workflow in `.github/workflows/pages.yml` deploys `site/` automatically on every push to `main` that changes the site.
3. The site is at **https://calhighceramics.org** (admin portal at `/admin.html`). Custom domain set in Settings → Pages; DNS at Ionos (four A records to GitHub Pages + `www` CNAME to `aik-data.github.io`).

## Connect Supabase (reference — already done for this project)

1. **Create a project** at supabase.com (the free tier is fine).
2. **Run the schema:** open the SQL Editor, paste in `supabase/migrations/20261119000000_init.sql`, and run it. Or use `supabase db push` with the Supabase CLI.
3. **Auth settings** (Authentication → Providers / Settings):
   - Turn **off** "Allow new users to sign up". Admins are invited instead.
   - Under URL Configuration, set the **Site URL** to your GitHub Pages address.
4. **Create the shared family login:**
   - Go to Authentication → Users → **Add user**.
   - Email: `family@ceramics-fundraiser.invalid` (or change `settings.family_email` to match whatever you use).
   - Password: the family password. Tick **Auto confirm**.
5. **Create the first admin:**
   - Add a user with your email and tick Auto confirm.
   - Then in the SQL Editor run:
     ```sql
     insert into public.admins (user_id, email)
     select id, email from auth.users where email = 'YOUR-EMAIL';
     update public.settings set notify_emails = array['YOUR-EMAIL'];
     ```
6. **Emails (optional but recommended):**
   - Create a free account at resend.com and verify a sending domain.
   - Then run:
     ```bash
     supabase secrets set RESEND_API_KEY=... FROM_EMAIL="Ceramics Sale <sale@yourdomain.org>" SITE_URL=https://calhighceramics.org
     supabase functions deploy order-notify
     supabase functions deploy admin-users
     ```
   - Without email set up, new orders still appear in the admin dashboard, which checks for new orders every 30 seconds.
7. **Point the site at Supabase:**
   - Put the project URL and the public **anon** key in `site/js/config.js`, then commit.
   - The anon key is safe to publish. All private data is protected by row-level security.

Admin email addresses and family details live only in Supabase, never in this public repository.

## Everyday use (admins)

1. **New order:** you get an email, and the order appears under **New orders** on the dashboard.
2. Open the order and click **Copy invoice details**. Create the invoice in FutureFund with the order number in the memo, then click **Mark invoice sent**.
3. When FutureFund shows the payment, click **Mark paid** and enter the amount received.
4. Orders still unpaid 48 hours after the invoice is sent are flagged **Overdue**. Send a reminder, or **Release** the order to put its pieces back on sale.
5. Record donations made through the [FutureFund donation page](https://calhigh.futurefund.com/store/campaigns/79740-ceramic-website-purchases) under **Donations**, so they count toward the goal.
6. Use **Settings** to change sale dates, pickup dates and times, the family password, the goal, and admins. Use **Reports** to download CSVs.
