-- Point the Donate link at the school's FutureFund campaign page
-- (it was a placeholder pointing at the FutureFund home page).
alter table public.settings
  alter column donate_url set default 'https://calhigh.futurefund.com/store/campaigns/79740-ceramic-website-purchases';

update public.settings
  set donate_url = 'https://calhigh.futurefund.com/store/campaigns/79740-ceramic-website-purchases'
  where donate_url = 'https://www.futurefund.com/' or donate_url is null or donate_url = '';
