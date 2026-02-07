# Render Deployment Guide

This guide will help you deploy your Money Manager backend to Render.

## Prerequisites
- Render account (https://render.com)
- MongoDB Atlas account or MongoDB database
- GitHub repository with this code

## Step 1: Prepare Your Environment Variables

The `.env` file has been updated with CORS configuration for Render. Make sure your Render environment variables match:

```env
PORT=5000
NODE_ENV=production
MONGO_URI=your_mongodb_connection_string
FRONTEND_URL=https://your-frontend-app.onrender.com
JWT_SECRET=your_secure_jwt_secret_key
```

## Step 2: Deploy to Render

### Option A: Using Render Web Interface

1. Go to https://render.com/dashboard
2. Click "New +" and select "Web Service"
3. Connect your GitHub repository
4. Fill in the configuration:
   - **Name**: money-manager-backend
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or paid for better performance)

5. Add Environment Variables:
   - Click "Advanced" and add the following:
   - `MONGO_URI`: Your MongoDB connection string
   - `FRONTEND_URL`: Your frontend Render URL (e.g., https://money-manager-frontend.onrender.com)
   - `JWT_SECRET`: Your JWT secret key
   - `NODE_ENV`: production

6. Click "Create Web Service"

### Option B: Using render-deploy.yaml (Infrastructure as Code)

Create a `render.yaml` file at the root of your repository:

```yaml
services:
  - type: web
    name: money-manager-backend
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: MONGO_URI
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
```

Then deploy using Render CLI.

## Step 3: Update Your Frontend

Update your frontend's API endpoint to point to your Render backend:

In your frontend `.env` file or config:
```
REACT_APP_API_URL=https://your-money-manager-backend.onrender.com
```

## Step 4: Configure CORS

The CORS configuration is now set to accept requests from:
- Your FRONTEND_URL (from env variable)
- localhost:3000, localhost:3001 (for local development)
- 127.0.0.1:3000 (for local development)

If you need to add more origins, update the `corsOptions` in `server.js`.

## Important Notes

1. **Free Tier Limitations**: 
   - Free Render services spin down after 15 minutes of inactivity
   - Use paid plans for production applications
   - Consider upgrading if response times are slow

2. **MongoDB Connection**:
   - Ensure your MongoDB has Render's IP in whitelist
   - Or use "Allow access from anywhere" (least secure, but works)
   - Better: Add Render's static IP to MongoDB whitelist

3. **Secure Your Secrets**:
   - Never commit `.env` files to GitHub
   - Always use Render's environment variable management
   - Rotate JWT_SECRET periodically

4. **Database Backups**:
   - Enable automatic backups in MongoDB Atlas
   - Regularly test restore procedures

## Monitoring & Logs

View your Render service logs:
1. Go to https://render.com/dashboard
2. Select your web service
3. Click "Logs" tab to see real-time logs

## Troubleshooting

### CORS Errors
- Ensure `FRONTEND_URL` is set correctly in Render environment
- Check frontend's API endpoint matches backend URL
- Clear browser cache and try again

### Database Connection Errors
- Verify `MONGO_URI` is correct
- Check MongoDB whitelist includes Render's IP
- Test connection string locally

### 502/503 Errors
- Check if backend is running: View logs from Render dashboard
- Restart the service from Render dashboard
- Check if MongoDB is accessible

### Slow Response Times
- Check if using free Render tier (auto-spindown)
- Upgrade to Starter or Pro plan
- Optimize database queries

## Additional Resources

- [Render Documentation](https://render.com/docs)
- [Deploying Node.js Apps](https://render.com/docs/deploy-node-express-app)
- [MongoDB Atlas + Render](https://www.mongodb.com/docs/drivers/node/)

## What Changed

Updated files for Render deployment:
- ✅ `.env` - Added FRONTEND_URL variable
- ✅ `.env.example` - Added Render-specific variables
- ✅ `server.js` - Configured CORS for production environments
