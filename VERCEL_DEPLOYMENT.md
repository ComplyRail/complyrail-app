# Deploy ComplyRail App to Vercel

## Option 1: GitHub Integration (Recommended - 3 minutes)

### Step 1: Sign Up/Login to Vercel
1. Go to https://vercel.com
2. Click "Sign Up" or "Log In"
3. Click "Continue with GitHub"
4. Authorize Vercel to access your GitHub account

### Step 2: Create New Project
1. On Vercel dashboard, click "New Project"
2. Find and click "ComplyRail/complyrail-app" repository
3. Click "Import"

### Step 3: Configure Project
1. **Framework Preset**: Vercel auto-detects "Next.js" ✓
2. **Root Directory**: Leave empty (uses repo root) ✓
3. **Environment Variables**: Leave empty for now (optional)
4. Click "Deploy"

### Step 4: Wait for Deployment
- Vercel builds and deploys automatically
- Takes ~2-3 minutes
- You get a live URL like `https://complyrail-app.vercel.app`

### Step 5: Custom Domain (Optional)
1. Go to project settings
2. Click "Domains"
3. Add your custom domain
4. Follow DNS setup instructions

---

## Option 2: Vercel CLI (For Advanced Users)

### Install Vercel CLI
```bash
npm install -g vercel
```

### Login to Vercel
```bash
vercel login
```

### Deploy
```bash
cd complyrail-app
vercel --prod
```

---

## Option 3: GitHub Actions (Automatic on Push)

Vercel automatically deploys when:
- PR created → Gets preview URL
- Merge to `main` → Deploys to production

No additional setup needed!

---

## After Deployment

### Verify Deployment
```bash
# Your app is live at:
https://complyrail-app.vercel.app

# Or with custom domain:
https://yourdomain.com
```

### Environment Variables (If Needed)
1. Vercel Dashboard → Project Settings → Environment Variables
2. Add any needed vars:
   - `NEXT_PUBLIC_STELLAR_NETWORK` = "testnet"
   - `NEXT_PUBLIC_CONTRACT_ADDRESS` = "CXXX..."
3. Redeploy (or push to main)

### View Logs
```bash
vercel logs [URL]
```

### Roll Back
Vercel dashboard → Deployments → Click deployment → Rollback

---

## Troubleshooting

### Build Failed
- Check build logs in Vercel dashboard
- Run `npm run build` locally to reproduce
- Fix issues and push to main

### Slow Build
- First build takes longer
- Subsequent builds use cache
- Typical time: 1-2 minutes

### Memory Issues
- Vercel has 3GB limit
- Our app uses ~200MB
- Should be fine

### Preview Deployments Not Working
- Make sure GitHub integration is complete
- Check repo is public or you have access
- Create a new PR to trigger

---

## Production Checklist

- [ ] App deployed to Vercel
- [ ] Domain configured (optional)
- [ ] Environment variables set
- [ ] Tests passing in CI
- [ ] No console errors in browser
- [ ] Stellar SDK connected properly
- [ ] Wallet integration tested

---

## Support

- Vercel Docs: https://vercel.com/docs
- Next.js Docs: https://nextjs.org/docs
- Chat Support: In Vercel dashboard
