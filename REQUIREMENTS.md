# Ceramics Fundraiser Website — Requirements

Status: **Draft for review** · Last updated: 2026-11-19

## 1. Goal

A beautiful, easy-to-use online gallery where school families can browse student ceramics and claim pieces, then pay through FutureFund. Separately from FutureFund, the site keeps an accurate inventory and tracks total money raised.

## 2. Decisions so far

| # | Topic | Decision |
|---|-------|----------|
| 1 | Piece types | **A mix:** one-of-a-kind pieces (quantity 1) alongside items that come in multiples |
| 2 | Size | **Under 50 listings** |
| 3 | Who can view | **School families only**, behind one shared password |
| 4 | Pricing | **Suggested donations:** each piece shows a suggested amount, and families may give more |
| 5 | Buying flow | **Claim, then pay:** a family claims pieces on the site, then pays in FutureFund |
| 6 | Double sales | **Time-limited hold:** a claimed piece is held for a set time while payment is pending |
| 7 | Upkeep | **Volunteers confirm each payment by hand** against FutureFund |
| 8 | Look and feel | **Modern, clean art gallery** |
| 9 | Extras | Student artist names, a fundraiser goal with a progress bar, pickup arrangements |
| 10 | Admin | Profit / money-raised totals (no detailed cost entry), downloadable reports |

## 3. Family-facing site

### 3.1 Access
- One shared family password, set by an admin. The site remembers it on that device, so families enter it once.
- Families don't create accounts.
- The site is hidden from search engines (`noindex`).

### 3.2 Gallery (home page)
- A short introduction to the fundraiser, with the **goal and a progress bar** (for example, "$1,240 of $2,500 raised").
- A grid of large photos with lots of white space. Each card shows:
  - the photo
  - the piece title
  - the student artist credit
  - the suggested donation
  - a status badge: **Available**, **On hold**, **Sold**, or "**3 left**" for multiples
- Simple sorting and filtering (all / available only, by category). With under 50 listings, search is not needed.

### 3.3 Piece detail page
- One to four photos, with zoom.
- Title, **artist credit** (first name + last initial, plus grade, e.g. "Maya R., Grade 4"), and an optional short description.
- Suggested donation, with a note that families may give more.
- For multiples: the quantity still available, and a quantity selector.
- A "Claim this piece" button.

### 3.4 Claiming (the "cart")
- Families add one or more pieces to a claim list.
- To submit the claim, they enter:
  - Parent/guardian name
  - Email address
  - Student name and teacher/class (for pickup and send-home)
  - Pickup choice, from options set by the admin (e.g. "Send home with my student", "Pick up at the Spring Concert, May 14")
- When they submit:
  - The pieces go **On hold** right away. Two families can never claim the last unit of the same piece, even if they click at the same moment.
  - The family gets a **claim code** (e.g. `CER-1042`) on screen and in a confirmation email. The email includes the FutureFund payment link, the pieces claimed, the suggested total, the hold deadline, and instructions to **put the claim code in the FutureFund note/comment**.
- Within 15 minutes of claiming, a family can cancel their claim from the confirmation page. After that, they contact a volunteer.

### 3.5 Privacy
- Student credits show first name + last initial only, with an optional grade.
- No photos of students.
- Parent emails and names are visible only to admins.

## 4. Inventory and holds

| Status | Meaning |
|--------|---------|
| Available | Can be claimed. For multiples, at least one unit is unclaimed |
| On hold | Claimed and waiting for payment |
| Sold | A volunteer has confirmed payment |
| Hidden | Draft or removed. Families can't see it |

- **Multiples:** each listing has a total quantity. Available = total − held − sold. The card shows "Sold out" when nothing is left.
- **Hold length:** 48 hours by default. Admins can change it in settings.
- **Expired holds:** because payment is confirmed by hand, an expired hold is **not released automatically**. That way a piece someone has already paid for can't be resold while the volunteer catches up. Instead, expired holds go to the top of the admin dashboard. A volunteer either marks the claim paid or releases it, which puts the piece back on sale.

## 5. Admin area (volunteers)

- Each volunteer signs in with their own login, separate from the family password. Expect 1–5 volunteers.

### 5.1 Listings
- Add, edit, or hide a piece: photos, title, artist name, grade, description, category, suggested donation, quantity.
- Photos are resized and compressed automatically.
- Optional: import listings from a simple spreadsheet (CSV) to speed up the initial setup.

### 5.2 Claims and payment confirmation
- A list of claims, filterable by status: **Awaiting payment**, **Hold expired**, **Paid**, **Released/cancelled**.
- Each claim shows: claim code, family name and email, pieces, suggested total, pickup choice, and time remaining on the hold.
- **Mark paid:** the volunteer enters the **amount actually received** from FutureFund. It defaults to the suggested total and can be edited, since families may give more. The pieces become **Sold**.
- **Release:** puts the held pieces back on sale. The volunteer can choose to email the family.
- **Partial changes:** a volunteer can remove one piece from a claim, for example when a family changes their mind about one item.
- An activity log records who marked what and when.

### 5.3 Dashboard: money raised
- **Total raised:** the sum of confirmed amounts received. This also drives the public progress bar.
- **Pending:** the suggested total of claims on hold.
- Pieces sold vs. available, and the number of donations above the suggested amount.
- **Profit:** no per-item cost tracking. The dashboard shows total raised. An optional single "total expenses" field in settings gives **net profit = total raised − expenses**. *(See open question 3.)*

### 5.4 Reports (CSV download)
- **Sales:** each confirmed sale, with piece, artist, family, amount received, and date.
- **Pickup / send-home list:** grouped by pickup option, then by teacher/class, so volunteers can pack and deliver.
- **Unpaid and expired claims:** for follow-up.
- **Inventory:** every piece with its status and remaining quantity.

### 5.5 Settings
- Family password
- Fundraiser goal amount
- Hold length
- FutureFund payment link
- Pickup options
- Total expenses (optional)
- Open/close the sale. When closed, families can browse but not claim.

## 6. Look and feel

- A modern, clean art gallery: a neutral off-white background, generous spacing, large photos, and refined typography with no clutter. The pieces provide the color.
- The school's logo or name appears in the header, with an accent color taken from the school colors.
- Mobile-first, since most parents will browse on their phones.
- Accessible: readable contrast, alt text on photos, and keyboard-friendly controls.

## 7. Technical approach (recommended)

- **Hosting:** a small web app on a free or low-cost host (Netlify or Vercel).
- **Database, photo storage, and admin logins:** a hosted backend such as Supabase (free tier). Its database lets the "claim" step reserve inventory reliably, so there are no double sales.
- **Email:** a transactional email service (e.g. Resend or Postmark) for claim confirmations.
- **FutureFund:** linked only. FutureFund offers no public API, which is why payments are confirmed by hand. If volunteers later want less manual work, a "upload FutureFund export CSV and auto-match by claim code" feature can be added.
- **Expected cost:** $0–$20 for the whole fundraiser, plus a custom domain if you want one.

## 8. Open questions

1. **How do families pay a suggested-donation amount in FutureFund?** Is there one "Ceramics Donation" item where the family types in an amount, or a fixed set of price items? Can families add a note (needed for the claim code)? This decides what the confirmation email tells them to do.
2. **Hold length:** is 48 hours right? Should holds be extended automatically over a weekend?
3. **Profit:** should "profit" just mean total raised, or do you want to subtract one total-expenses figure? (A single total is the current assumption.)
4. **Pickup options:** what are the actual dates and places, and is "send home with student" allowed?
5. **Sale window:** what are the open and close dates? Should there be a volunteer-only preview before families get the password?
6. **Artist credit:** is grade enough, or should teacher/class also appear publicly?
7. **Unclaimed pieces after the sale:** offer them to the student's family first, or hold a second round?
8. **Who owns the accounts:** which school email should own the hosting, database, and email accounts, so they outlast any one volunteer?

## 9. Out of scope (for now)

- Taking payments on the site. All payments go through FutureFund.
- Family accounts and order history.
- Automatic FutureFund syncing.
- Auctions or bidding.
