# Woodhouse Voucher Desk

Makes print-ready PDF vouchers for Woodhouse Adventure Park:

- **Gift voucher** — three lines of wording (with presets for the common
  passes), a *valid to* date (defaults to three years from today) and a
  voucher number.
- **Club Woodhouse membership** — a *must be activated by* date (defaults to
  the end of the month, three months out) and a voucher number.

Live at **https://vouchers.woodhousestaff.app**.

The preview on the right is true to print. **Download PDF** fills the
official design and saves it. The PDF opens without a password and prints
normally, but is locked against editing and copying text. The app also
remembers the last voucher number you used (in that browser only) and
suggests the next one.

## Password

The whole site sits behind a staff password. Nothing loads without it, not
the app and not the voucher designs. Signing in lasts 30 days on that device;
**Sign out** is top right. After 10 wrong tries in a minute from one address,
further tries are refused until the minute is up.

The password is **not in this code**. It's the Worker secret
`ACCESS_PASSWORD`: **Workers & Pages → vouchers → Settings → Variables and
Secrets**. Cloudflare stores it encrypted and won't show it again. To change
it, edit that secret and deploy. Changing it signs everyone out. If the
secret is ever removed, the site stays locked rather than opening up.

## How it works

Apart from the password check (`src/index.js`), everything happens in the
browser and nothing is stored or sent anywhere: the page loads the PDF template, writes the text onto
it with [pdf-lib](https://github.com/cantoo-scribe/pdf-lib), encrypts it, and
downloads it.

```
src/index.js               password check in front of every request
public/index.html          the whole app
public/gift-template.pdf   gift voucher design (what gets filled in)
public/gift-bg.jpg         image of the same design, for the preview
public/club-template.pdf   Club Woodhouse design
public/club-bg.jpg         its preview image
public/vendor/             pdf-lib 2.11.1 (@cantoo/pdf-lib), kept locally
wrangler.jsonc             Cloudflare Worker settings
```

## Hosting

A Cloudflare Worker with static assets, called `vouchers`. Every request goes
through `src/index.js` first. Every push to the
production branch redeploys it automatically, usually within a minute. The
address `vouchers.woodhousestaff.app` is attached under **Workers & Pages →
vouchers → Domains**.

To change a design, replace its PDF template **and** its preview image
together, keeping the same file names. If the layout of the fields moves, the
positions are in the `T` table near the top of the script in `index.html`
(PDF points, measured from the bottom-left corner).
