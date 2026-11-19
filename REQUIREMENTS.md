# Ceramics Fundraiser Website — Requirements

Status: **Draft for review** · Last updated: 2026-11-19

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
| 4 | Pricing | **Suggested donations:** each piece shows a suggested amount, and families may give more |
| 5 | Buying flow | **Check out → admin is notified → admin sends a FutureFund invoice → family pays** |
| 6 | Double sales | Pieces are **held** from checkout until the admin marks them paid or releases them |
| 7 | Upkeep | **Admins confirm each payment by hand** against FutureFund |
| 8 | Look and feel | **Modern, clean art gallery** |
| 9 | Extras | Student artist names, a fundraiser goal with a progress bar, pickup dates and times set by admins |
| 10 | Admin | New-order alerts (email + dashboard), profit / money-raised totals (no detailed cost entry), downloadable reports |

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
- Title, **artist credit** (first name + last initial, plus grade, e.g. "Maya R., Grade 4"), and an optional short description.
- Suggested donation, with a note that families may give more.
- For multiples: the quantity still available, and a quantity selector.
- An "Add to cart" button.

### 4.4 Cart and checkout
- Families add one or more pieces to a cart.
- To check out, they enter:
  - Parent/guardian name
  - Email address (where the FutureFund invoice will be sent)
  - Phone number (optional)
  - Student name and teacher/class
  - **Pickup choice:** a dropdown of the pickup dates, times and places the admins set up (§6.5)
  - Notes (optional)
- When they place the order:
  1. The pieces go **On hold** right away. Two families can never get the last unit of the same piece, even if they check out at the same moment.
  2. The family sees a confirmation page with an **order number** (e.g. `CER-1042`) and gets a confirmation email. It lists the pieces, the suggested total and the pickup choice, and says: *"You'll receive an invoice from FutureFund shortly. Your pieces are reserved for you."*
  3. **The admins get an email** about the new order (§5).
  4. **The order appears in the admin dashboard** as a new order (§6.2).
- Families do **not** pay on the site and do **not** get a direct FutureFund link. They pay the invoice the admin sends.

### 4.5 Privacy
- Student credits show first name + last initial only, with an optional grade.
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
- **Copy invoice details:** one click copies a ready-to-paste summary for creating the FutureFund invoice. It has the family name and email, the order number, the list of items and the suggested total.
- **Mark invoice sent:** records the date the invoice was sent.
- **Mark paid:** the admin enters the **amount actually received** in FutureFund. It defaults to the suggested total and can be edited, since families may give more. The pieces become **Sold**.
- **Release:** cancels the order or part of it and puts those pieces back on sale. The admin can choose to email the family.
- **Edit order:** remove an item or change a quantity, for example when a family changes their mind.
- **Overdue flag:** an order shows as overdue if it has stayed in *Invoice sent* longer than the reminder period in settings (default: 3 days), so the admin can follow up. Pieces are **never released automatically**. Only an admin can release them.
- An activity log records which admin did what and when.

### 6.3 Listings
- Add, edit, or hide a piece: photos, title, artist name, grade, description, category, suggested donation, quantity.
- Photos are resized and compressed automatically.
- Optional: import listings from a simple spreadsheet (CSV) to speed up the initial setup.

**Inventory rules**
- Statuses: **Available**, **On hold**, **Sold**, **Hidden** (a draft or removed piece families can't see).
- Multiples: available = total quantity − on hold − sold. The card shows "Sold out" when nothing is left.

### 6.4 Dashboard: money raised
- **New orders** alert box (§5).
- **Total raised:** the sum of confirmed amounts received. This also drives the public progress bar.
- **Awaiting payment:** the suggested total of orders that are New or Invoice sent.
- Pieces sold vs. available, and the number of donations above the suggested amount.
- **Profit:** no per-item cost tracking. The dashboard shows total raised. An optional single "total expenses" field gives **net profit = total raised − expenses**.

### 6.5 Settings (admin-managed)
- **Pickup dates and times:** add, edit, reorder, or turn off pickup options. Each one has a label, date, start and end time, location, and an optional note.
  - Example: "Spring Concert — Thu May 14, 6:00–7:30 PM, School Gym"
  - Example: "Send home with my student"
  - Only active options appear at checkout.
- **Admin notification emails:** who receives new-order emails.
- **Admin users:** invite or remove admins.
- **Family password.**
- **Fundraiser goal amount.**
- **Overdue reminder period:** in days.
- **Total expenses:** optional.
- **Sale open/closed:** when closed, families can browse but not check out.

### 6.6 Reports (CSV download)
- **Sales:** each paid order, with pieces, artist, family, amount received, and date.
- **Pickup list:** grouped by pickup date and time, then by teacher/class, for packing and handing out.
- **Open orders:** New and Invoice sent orders, with how long each has been waiting.
- **Inventory:** every piece with its status and remaining quantity.

## 7. Look and feel

- A modern, clean art gallery: a neutral off-white background, generous spacing, large photos, and refined typography with no clutter. The pieces provide the color.
- The school's logo or name appears in the header, with an accent color taken from the school colors.
- Mobile-first, since most parents will browse on their phones.
- Accessible: readable contrast, alt text on photos, and keyboard-friendly controls.

## 8. Technical approach (recommended)

- **Hosting:** a small web app on a free or low-cost host (Netlify or Vercel).
- **Database, photo storage, and admin logins:** a hosted backend such as Supabase (free tier). Its database lets checkout reserve inventory reliably, so there are no double sales.
- **Email:** a transactional email service (e.g. Resend or Postmark) for family confirmations and admin new-order alerts.
- **FutureFund:** used only by admins to send invoices and collect payment. FutureFund offers no public API, so invoices are created by hand and payments are confirmed by hand. The "Copy invoice details" button keeps that quick.
- **Expected cost:** $0–$20 for the whole fundraiser, plus a custom domain if you want one.

## 9. Open questions

1. **FutureFund invoices:** can an invoice let the family pay *more* than the invoiced amount, or does it need a separate donation line? Can the order number go in the invoice memo?
2. **Overdue period:** is 3 days after the invoice is sent the right time to flag an order for follow-up?
3. **Sale window:** what are the open and close dates? Should admins preview the site before families get the password?
4. **Artist credit:** is grade enough, or should teacher/class also appear publicly?
5. **Unclaimed pieces after the sale:** offer them to the student's family first, or hold a second round?
6. **Account ownership:** which school email should own the hosting, database and email accounts, so they outlast any one admin?

## 10. Out of scope (for now)

- Taking payments on the site. All payments go through FutureFund invoices.
- Family accounts and order history.
- Automatic FutureFund syncing.
- Auctions or bidding.
