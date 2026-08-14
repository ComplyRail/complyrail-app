# ComplyRail App Deployment

## Vercel Deployment

The ComplyRail app is configured for automatic deployment to Vercel.

### Prerequisites

- Vercel account (free tier available at https://vercel.com)
- GitHub repository access

### One-Time Setup

1. Visit https://vercel.com and sign up/log in
2. Click "New Project"
3. Import the `complyrail-app` repository from GitHub
4. Vercel will auto-detect Next.js settings
5. Click "Deploy"

### Environment Variables

If needed, add environment variables in Vercel dashboard:
- Project Settings → Environment Variables

Common vars:
- `NEXT_PUBLIC_STELLAR_NETWORK` - "testnet" or "public" (Stellar network)
- `NEXT_PUBLIC_CONTRACT_ADDRESS` - Soroban contract address on Stellar

### Automatic Deployments

- **Preview**: Every PR gets a preview deployment
- **Production**: Merges to `main` automatically deploy to production

### Manual Deployment

Push to `main` branch and Vercel will deploy automatically:
```bash
git push origin main
```

### Monitoring

- View deployments at https://vercel.com/dashboard
- Check build logs if deployment fails
- Preview URLs available for each deployment

### Troubleshooting

If build fails:
1. Check Vercel build logs
2. Ensure all dependencies are in package-lock.json locally
3. Run `npm install` locally and verify build succeeds: `npm run build`
4. Commit lock file changes and retry

## Local Development

```bash
npm install
npm run dev
```

Visit http://localhost:3000

## Production Build

```bash
npm run build
npm start
```
