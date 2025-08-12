Here’s a clear step-by-step guide to setting up your Bitcoin Block RNG site with your domain **bitcoinblockrng.com** on GitHub Pages:

---

## **1. Create a GitHub Repository**
1. Go to [GitHub](https://github.com/) and log in.
2. Click the **+** in the top right → **New repository**.
3. Name it something like **bitcoinblockrng**.
4. Set it to **Public**.
5. Click **Create repository**.

---

## **2. Add Your Website Files**
1. On your new repository page, click **Add file → Upload files**.
2. Upload your HTML file (from our code), plus your `lnurladdress.png` QR code.
3. Name the main HTML file **index.html**.
4. Commit the changes.

---

## **3. Enable GitHub Pages**
1. Go to your repository **Settings** → **Pages** (on the left sidebar).
2. Under **Source**, select **Deploy from a branch**.
3. Under **Branch**, choose **main** (or `master`) and folder `/root`.
4. Click **Save**.
5. Your site will be published at: `https://<username>.github.io/bitcoinblockrng/`

---

## **4. Connect Your Custom Domain**
1. Buy a domain from a registrar (e.g., Namecheap, Google Domains, Porkbun).
2. In **Settings → Pages** of your repo, enter `bitcoinblockrng.com` in the **Custom domain** field.
3. At your domain registrar’s DNS settings, add:
   - **CNAME record**: `@` → `<username>.github.io`
4. Wait for DNS propagation (can take a few hours).

---

## **5. Test Your Site**
Visit `bitcoinblockrng.com` in your browser. If it doesn’t work immediately, wait for DNS to finish updating.
