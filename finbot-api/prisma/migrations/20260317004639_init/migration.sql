-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'STARTER', 'PRO', 'BUSINESS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentScore" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "reports" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "asset" TEXT,
    "event" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockProfile" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT,
    "exchange" TEXT,
    "sector" TEXT,
    "industry" TEXT,
    "description" TEXT,
    "ceo" TEXT,
    "employees" INTEGER,
    "website" TEXT,
    "country" TEXT,
    "ipoDate" TEXT,
    "currency" TEXT,
    "isEtf" BOOLEAN,
    "price" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "changePct" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "pe" DOUBLE PRECISION,
    "eps" DOUBLE PRECISION,
    "beta" DOUBLE PRECISION,
    "weekHigh52" DOUBLE PRECISION,
    "weekLow52" DOUBLE PRECISION,
    "avgVolume" DOUBLE PRECISION,
    "dcfValue" DOUBLE PRECISION,
    "aiSummary" TEXT,
    "aiSummaryAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockFinancials" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "incomeStatement" JSONB NOT NULL,
    "balanceSheet" JSONB NOT NULL,
    "cashFlow" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockFinancials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAnalysts" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "grades" JSONB NOT NULL,
    "priceTargetConsensus" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAnalysts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockOwnership" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "institutional" JSONB NOT NULL,
    "etfs" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "SentimentScore_articleId_key" ON "SentimentScore"("articleId");

-- CreateIndex
CREATE INDEX "SentimentScore_asset_createdAt_idx" ON "SentimentScore"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "SentimentScore_createdAt_idx" ON "SentimentScore"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_jobId_key" ON "AnalysisResult"("jobId");

-- CreateIndex
CREATE INDEX "AnalysisResult_asset_createdAt_idx" ON "AnalysisResult"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisResult_createdAt_idx" ON "AnalysisResult"("createdAt");

-- CreateIndex
CREATE INDEX "Webhook_asset_event_idx" ON "Webhook"("asset", "event");

-- CreateIndex
CREATE INDEX "Webhook_userId_idx" ON "Webhook"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StockProfile_ticker_key" ON "StockProfile"("ticker");

-- CreateIndex
CREATE INDEX "StockProfile_ticker_idx" ON "StockProfile"("ticker");

-- CreateIndex
CREATE INDEX "StockProfile_updatedAt_idx" ON "StockProfile"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockFinancials_ticker_key" ON "StockFinancials"("ticker");

-- CreateIndex
CREATE INDEX "StockFinancials_ticker_idx" ON "StockFinancials"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "StockAnalysts_ticker_key" ON "StockAnalysts"("ticker");

-- CreateIndex
CREATE INDEX "StockAnalysts_ticker_idx" ON "StockAnalysts"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "StockOwnership_ticker_key" ON "StockOwnership"("ticker");

-- CreateIndex
CREATE INDEX "StockOwnership_ticker_idx" ON "StockOwnership"("ticker");

-- CreateIndex
CREATE INDEX "UsageLog_userId_createdAt_idx" ON "UsageLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageLog_createdAt_idx" ON "UsageLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
