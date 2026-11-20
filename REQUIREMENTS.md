# Ceramics Fundraiser Website — Requirements

Status: **Approved for build** · Last updated: 2026-11-20

> **Update — Cal High policy (2026-11-20).** These changes replace the invoice flow described in the sections below.
> - **Branding:** "California High School Ceramics", with the Cal High Ceramics logo, the Grizzlies banner, and orange/black colors.
> - **Flow:** families **reserve** (the button says "Reserve"), then donate the suggested amount themselves through the FutureFund link and keep the receipt. Admins don't send invoices.
> - **Order stages:** Reserved → Paid (seen in FutureFund) → Picked up. A receipt checked at pickup can mark a reservation paid and picked up in one step. An unpaid reservation is flagged 48 hours after it was made, and only an admin can release it.
> - **Checkout fields:** first name, last name, email, phone and notes. No student, class or pickup choice.
> - **Pickup:** any of the pickup days (12/11, 12/14, 12/15), before or after school, in Room 3002. Pickup days are a setting.
> - **Instructions:** an editable setting, using `{link}` and `{pickup_days}` placeholders. Shown in the cart and on the reservation page, and copied into the admin email.
> - **Confirmation:** families get no email. The reservation page has a "Print / Save as PDF" button and warns them before they leave without saving. The admin alert email is a complete record they can forward to the family.
> - **Credit:** always generic — "Handcrafted by a Cal High Ceramics 1 student".

## 1. Goal

A beautiful, easy-to-use online gallery where school families can browse student ceramics and check out the pieces they want. An admin then invoices them through FutureFund. Separately from FutureFund, the site keeps an accurate inventory and tracks total money raised.

## 2. Roles

The site has two kinds of users:

| Role | Who | How they get in |
|------|-----|-----------------|
| **Families (customers)** | School parents and guardians | One shared family password. No accounts |
| **Admins** | The people running the fundraiser | A personal login (email + password) |

There is no separate volunteer role. Everything behind the scenes is done by admins.

## 3. Decisions so far

| # | Topic | Decision |
|---|-------|----------|
| 1 | Piece types | **A mix:** one-of-a-kind pieces (quantity 1) alongside items that come in multiples |
| 2 | Size | **Under 50 listings** |
| 3 | Who can view | **School families only**, behind one shared password |
| 4 | Pricing | **Suggested donations:** each piece shows a suggested amount, which is what the invoice charges |
| 5 | Buying flow | **Check out → admin is notified → admin sends a FutureFund invoice → family pays** |
| 6 | Double sales | Pieces are **held** from checkout until the admin marks them paid or releases them |
| 7 | Upkeep | **Admins confirm each payment by hand** against FutureFund |
| 8 | Look and feel | **Modern, clean art gallery** |
| 9 | Extra giving | A **Donate** button that goes straight to FutureFund. No item and no invoice needed |
| 10 | Sale dates | Open and close dates are **admin settings**, and the site follows them automatically |
| 11 | Extras | Student artist name (name only), a fundraiser goal with a progress bar, pickup dates and times set by admins |
| 12 | Admin | New-order alerts (email + dashboard), profit / money-raised totals (no detailed cost entry), downloadable reports |

## 4. Family-facing site

### 4.1 Access
- One shared family password, set by an admin. The site remembers it on that device, so families enter it once.
- Families don't create accounts.
- The site is hidden from search engines (`noindex`).

### 4.2 Gallery (home page)
- A short introduction to the fundraiser, with the **goal and a progress bar** (for example, "$1,240 of $2,500 raised").
- A grid of large photos with lots of white space. Each card shows:
  - the photo
  - the piece title
  - the student artist credit
  - the suggested donation
  - a status badge: **Available**, **On hold**, **Sold**, or "**3 left**" for multiples
- Simple sorting and filtering (all / available only, by category). With under 50 listings, search is not needed.

### 4.3 Piece detail page
- One to four photos, with zoom.
- Title, **artist name** (entered by the admin exactly as it should appear), and an optional short description.
- Suggested donation.
- For multiples: the quantity still available, and a quantity selector.
- An "Add to cart" button.

### 4.4 Cart and checkout
- Families add one or more pieces to a cart.
- To check out, they enter:
  - Parent/guardian first name and last name
  - Email address (where the FutureFund invoice will be sent)
  - Phone number (required)
  - Student name and teacher/class
  - **Pickup choice:** a dropdown of the pickup dates, times and places the admins set up (§6.5)
  - Notes (optional)
- When they place the order:
  1. The pieces go **On hold** right away. Two families can never get the last unit of the same piece, even if they check out at the same moment.
  2. The family sees a confirmation page with an **order number** (e.g. `CER-1042`) listing the pieces, the suggested total and the pickup choice, with the message: *"Your pieces are reserved for you. Your FutureFund invoice will be sent to [email]."* No confirmation email is sent to families; the admin's FutureFund invoice is their written confirmation.
  3. **The admins get an email** about the new order (§5).
  4. **The order appears in the admin dashboard** as a new order (§6.2).
- Families do **not** pay for pieces on the site. They pay the invoice the admin sends. (Extra giving is separate. See §4.5.)

### 4.5 Donate (extra giving)
- Families can give an extra donation **without buying a piece and without an invoice**.
- A **"Make a donation"** button appears in the header, on the home page, and on the checkout confirmation page.
- It opens the school's **FutureFund donation page** directly. The link is set in admin settings. *Until the school's donation page exists, it points to the FutureFund home page.*
- The site never sees these payments. To count a donation toward the goal, an admin records it in the dashboard (§6.4).

### 4.6 Sale dates
- The sale opens and closes automatically, using the dates and times the admins set (§6.5).
- **Before the sale opens:** families see a "Coming soon — sale opens [date/time]" page with the fundraiser intro. Admins can still see everything.
- **While the sale is open:** browsing and checkout both work.
- **After the sale closes:** families can still browse the gallery and use the Donate button, but they can't check out. A banner shows "The sale has ended — thank you!"

### 4.7 Privacy
- Pieces are credited with the artist's name only. No grade or class is shown.
- No photos of students.
- Family names, emails and phone numbers are visible only to admins.

## 5. New-order notifications

When a family checks out:

- **Email to the admins:** sent to every address on the "notify" list in settings. It includes:
  - the order number
  - family name, email and phone
  - student name and class
  - the pieces and quantities, with suggested amounts
  - the suggested total
  - the pickup choice
  - any notes
  - a button linking straight to the order in the admin dashboard
- **Dashboard alert:** the order appears at the top of the dashboard under **New orders**, marked unread. A badge shows how many new orders there are, e.g. "New orders (3)". The badge goes away once an admin opens the order.

## 6. Admin area

### 6.1 Order flow

```
Family checks out ──► NEW ──► INVOICE SENT ──► PAID
                       │            │
                       └────────────┴──► RELEASED (pieces go back on sale)
```

| Order status | Meaning | Piece status |
|--------------|---------|--------------|
| New | Family checked out. The admin hasn't sent an invoice yet | On hold |
| Invoice sent | The admin sent the FutureFund invoice | On hold |
| Paid | The admin confirmed payment in FutureFund | Sold |
| Released | Cancelled or unpaid. The pieces go back on sale | Available |

### 6.2 Orders page
- Lists orders with tabs for **New**, **Invoice sent**, **Paid** and **Released**. New orders appear first.
- Each order shows:
  - the order number
  - family contact details
  - student and class
  - pieces and quantities
  - the suggested total
  - the pickup choice and notes
  - how long the order has been waiting
- **Copy invoice details:** one click copies a ready-to-paste summary for creating the FutureFund invoice. It has the family name and email, the list of items and the suggested total. The **order number goes in the invoice memo**, so the payment can be matched to the order.
- **Mark invoice sent:** records the date the invoice was sent.
- **Mark paid:** the admin enters the **amount actually received** in FutureFund. It defaults to the invoiced total and can be edited if the payment was different. The pieces become **Sold**.
- **Release:** cancels the order or part of it and puts those pieces back on sale. The admin can choose to email the family.
- **Edit order:** remove an item or change a quantity, for example when a family changes their mind.
- **Overdue flag:** an order shows as overdue if it has stayed in *Invoice sent* longer than the reminder period in settings (default: **48 hours**), so the admin can follow up. Pieces are **never released automatically**. Only an admin can release them.
- An activity log records which admin did what and when.

### 6.3 Listings
- Add, edit, or hide a piece: photos, title, artist name, description, category, suggested donation, quantity.
- Photos are resized and compressed automatically.
- Optional: import listings from a simple spreadsheet (CSV) to speed up the initial setup.

**Inventory rules**
- Statuses: **Available**, **On hold**, **Sold**, **Hidden** (a draft or removed piece families can't see).
- Multiples: available = total quantity − on hold − sold. The card shows "Sold out" when nothing is left.

### 6.4 Dashboard: money raised
- **New orders** alert box (§5).
- **Total raised** = paid orders + recorded donations. This also drives the public progress bar.
  - **Sales:** the sum of amounts received on paid orders.
  - **Donations:** the sum of donations an admin recorded.
- **Record donation:** for donations made through the FutureFund donation page. The admin enters the amount, the date, and optionally a name and note. Recorded donations can be edited or deleted. Admins can enter each donation separately, or one running total copied from FutureFund.
- **Awaiting payment:** the invoiced total of orders that are New or Invoice sent.
- Pieces sold vs. available.
- **Profit:** no per-item cost tracking. The dashboard shows total raised. An optional single "total expenses" field gives **net profit = total raised − expenses**.

### 6.5 Settings (admin-managed)
- **Pickup dates and times:** add, edit, reorder, or turn off pickup options. Each one has a label, date, start and end time, location, and an optional note.
  - Example: "Spring Concert — Thu May 14, 6:00–7:30 PM, School Gym"
  - Example: "Send home with my student"
  - Only active options appear at checkout.
- **Admin notification emails:** who receives new-order emails. *(For now, the owner's email. It is set in the admin settings and is not stored in the public code repository.)*
- **Admin users:** invite or remove admins.
- **Family password.**
- **Fundraiser goal amount.**
- **Overdue reminder period:** in hours (default 48).
- **Total expenses:** optional.
- **Sale dates:** the date and time the sale opens and the date and time it closes, in the school's time zone. The site switches between Coming soon, Open and Closed on its own.
  - **Pause checkout:** an override that stops checkout early or temporarily, whatever the dates say.
- **FutureFund donation link:** the page the Donate button opens.

### 6.6 Reports (CSV download)
- **Sales:** each paid order, with pieces, artist, family, amount received, and date.
- **Donations:** each recorded donation.
- **Pickup list:** grouped by pickup date and time, then by teacher/class, for packing and handing out.
- **Open orders:** New and Invoice sent orders, with how long each has been waiting.
- **Inventory:** every piece with its status and remaining quantity.

After the sale closes, there is no special process for unsold pieces. They simply stay unsold.

## 7. Look and feel

- A modern, clean art gallery: a neutral off-white background, generous spacing, large photos, and refined typography with no clutter. The pieces provide the color.
- The school's logo or name appears in the header, with an accent color taken from the school colors.
- Mobile-first, since most parents will browse on their phones.
- Accessible: readable contrast, alt text on photos, and keyboard-friendly controls.

## 8. Technical approach

| Part | Choice | Why |
|------|--------|-----|
| Website hosting | **GitHub Pages** (free), deployed from this repo | The site is plain HTML/CSS/JS, so no build step or server is needed |
| Database, admin logins, photo storage | **Supabase** (free tier) | GitHub Pages can only serve files. It has no database, no private data, and no logins. Supabase provides all three, plus the locking that stops two families buying the same piece |
| Emails | **Supabase Edge Function + Resend** (free tier) | Sends the admin new-order alert only, from Resend's shared address (`onboarding@resend.dev`), so no domain is needed. The Resend account must use the admin's email. The API key stays secret on Supabase |
| FutureFund | Linked only | Admins send invoices and families pay there. FutureFund offers no public API, so invoices and payment confirmations are done by hand |

- **Family password:** a single shared Supabase login. Families only type the password, and the site remembers it on that device.
- **Data privacy:** the repository is public, so it holds **code only**. Family details, orders and admin emails live in Supabase, protected by row-level security. The Supabase "anon" key in the code is designed to be public.
- **Demo mode:** if Supabase isn't connected yet, the site runs on sample data stored in the browser. That lets the GitHub Page be previewed right away.
- **Expected cost:** $0 on the free tiers. A custom domain is optional (about $12/year).

## 9. Open items

1. **FutureFund donation page:** the school will add it later. Until then, the Donate button links to the FutureFund home page.
2. **Admin email:** the final admin email will be provided. The owner's email is used for now.

## 10. Out of scope (for now)

- Taking payments on the site. Pieces are paid by FutureFund invoice, and extra donations through the FutureFund donation page.
- Family accounts and order history.
- Automatic FutureFund syncing.
- Auctions or bidding.
