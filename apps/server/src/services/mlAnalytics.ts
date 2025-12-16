/**
 * ML Analytics Service
 * 
 * Provides machine learning capabilities for ELN data analysis:
 * - Outlier detection on experimental measurements
 * - Clustering of experiments by similarity
 * - Trend analysis and forecasting
 * - Experiment outcome prediction
 * - Integration with Python ML frameworks via subprocess
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const prisma = new PrismaClient();

// ============================================================================
// Statistical Utilities (Pure TypeScript implementations)
// ============================================================================

interface NumericData {
  values: number[];
  labels?: string[];
}

interface OutlierResult {
  index: number;
  value: number;
  label?: string;
  zScore: number;
  isOutlier: boolean;
  outlierType: 'high' | 'low' | 'none';
}

interface ClusterResult {
  clusterId: number;
  centroid: number[];
  members: Array<{
    id: string;
    values: number[];
    distance: number;
  }>;
}

interface TrendResult {
  slope: number;
  intercept: number;
  rSquared: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  prediction?: number[];
  confidence: number;
}

interface PredictionResult {
  predictedOutcome: string;
  confidence: number;
  factors: Array<{
    name: string;
    importance: number;
    value: unknown;
  }>;
  similarExperiments: Array<{
    id: string;
    title: string;
    outcome: string;
    similarity: number;
  }>;
}

// Basic statistics
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function covariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xMean = mean(x.slice(0, n));
  const yMean = mean(y.slice(0, n));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (x[i] - xMean) * (y[i] - yMean);
  }
  return sum / (n - 1);
}

function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const xStd = standardDeviation(x.slice(0, n));
  const yStd = standardDeviation(y.slice(0, n));
  if (xStd === 0 || yStd === 0) return 0;
  return covariance(x.slice(0, n), y.slice(0, n)) / (xStd * yStd);
}

function euclideanDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += Math.pow(a[i] - b[i], 2);
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============================================================================
// Outlier Detection
// ============================================================================

/**
 * Detect outliers using Z-score method
 */
function detectOutliersZScore(
  data: NumericData,
  threshold: number = 3.0
): OutlierResult[] {
  const { values, labels } = data;
  const avg = mean(values);
  const std = standardDeviation(values);
  
  if (std === 0) {
    return values.map((v, i) => ({
      index: i,
      value: v,
      label: labels?.[i],
      zScore: 0,
      isOutlier: false,
      outlierType: 'none' as const
    }));
  }
  
  return values.map((v, i) => {
    const zScore = (v - avg) / std;
    const isOutlier = Math.abs(zScore) > threshold;
    return {
      index: i,
      value: v,
      label: labels?.[i],
      zScore,
      isOutlier,
      outlierType: isOutlier ? (zScore > 0 ? 'high' : 'low') : 'none'
    };
  });
}

/**
 * Detect outliers using IQR (Interquartile Range) method
 */
function detectOutliersIQR(
  data: NumericData,
  multiplier: number = 1.5
): OutlierResult[] {
  const { values, labels } = data;
  const q1 = percentile(values, 25);
  const q3 = percentile(values, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - multiplier * iqr;
  const upperBound = q3 + multiplier * iqr;
  const avg = mean(values);
  const std = standardDeviation(values);
  
  return values.map((v, i) => {
    const isOutlier = v < lowerBound || v > upperBound;
    const zScore = std === 0 ? 0 : (v - avg) / std;
    return {
      index: i,
      value: v,
      label: labels?.[i],
      zScore,
      isOutlier,
      outlierType: isOutlier ? (v > upperBound ? 'high' : 'low') : 'none'
    };
  });
}

/**
 * Detect outliers using Modified Z-Score (MAD-based)
 */
function detectOutliersMAD(
  data: NumericData,
  threshold: number = 3.5
): OutlierResult[] {
  const { values, labels } = data;
  const med = median(values);
  const absoluteDeviations = values.map(v => Math.abs(v - med));
  const mad = median(absoluteDeviations);
  const k = 1.4826; // Consistency constant for normal distribution
  
  if (mad === 0) {
    return values.map((v, i) => ({
      index: i,
      value: v,
      label: labels?.[i],
      zScore: 0,
      isOutlier: v !== med,
      outlierType: v !== med ? (v > med ? 'high' : 'low') : 'none'
    }));
  }
  
  return values.map((v, i) => {
    const modifiedZScore = (v - med) / (k * mad);
    const isOutlier = Math.abs(modifiedZScore) > threshold;
    return {
      index: i,
      value: v,
      label: labels?.[i],
      zScore: modifiedZScore,
      isOutlier,
      outlierType: isOutlier ? (modifiedZScore > 0 ? 'high' : 'low') : 'none'
    };
  });
}

// ============================================================================
// Clustering (K-Means Implementation)
// ============================================================================

interface KMeansOptions {
  k: number;
  maxIterations?: number;
  tolerance?: number;
}

function initializeCentroids(data: number[][], k: number): number[][] {
  // K-means++ initialization
  const centroids: number[][] = [];
  const n = data.length;
  const dims = data[0]?.length ?? 0;
  
  if (n === 0 || dims === 0) return centroids;
  
  // Pick first centroid randomly
  centroids.push([...data[Math.floor(Math.random() * n)]]);
  
  // Pick remaining centroids
  while (centroids.length < k) {
    const distances: number[] = data.map(point => {
      const minDist = Math.min(...centroids.map(c => euclideanDistance(point, c)));
      return minDist * minDist;
    });
    
    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    
    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        centroids.push([...data[i]]);
        break;
      }
    }
  }
  
  return centroids;
}

function assignToClusters(data: number[][], centroids: number[][]): number[] {
  return data.map(point => {
    let minDist = Infinity;
    let clusterId = 0;
    centroids.forEach((centroid, i) => {
      const dist = euclideanDistance(point, centroid);
      if (dist < minDist) {
        minDist = dist;
        clusterId = i;
      }
    });
    return clusterId;
  });
}

function updateCentroids(data: number[][], assignments: number[], k: number): number[][] {
  const dims = data[0]?.length ?? 0;
  const newCentroids: number[][] = Array.from({ length: k }, () => 
    Array(dims).fill(0)
  );
  const counts: number[] = Array(k).fill(0);
  
  data.forEach((point, i) => {
    const clusterId = assignments[i];
    // Strict bounds check and type validation to prevent prototype pollution
    if (typeof clusterId === 'number' && 
        Number.isInteger(clusterId) && 
        clusterId >= 0 && 
        clusterId < k &&
        Object.prototype.hasOwnProperty.call(newCentroids, clusterId)) {
      point.forEach((val, d) => {
        if (typeof d === 'number' && d >= 0 && d < dims && typeof val === 'number' && isFinite(val)) {
          newCentroids[clusterId][d] += val;
        }
      });
      counts[clusterId]++;
    }
  });
  
  return newCentroids.map((centroid, i) => 
    counts[i] > 0 ? centroid.map(v => v / counts[i]) : centroid
  );
}

function kMeans(
  data: number[][],
  options: KMeansOptions
): ClusterResult[] {
  const { k, maxIterations = 100, tolerance = 0.0001 } = options;
  
  if (data.length === 0 || data.length < k) {
    return [];
  }
  
  let centroids = initializeCentroids(data, k);
  let assignments = assignToClusters(data, centroids);
  
  for (let iter = 0; iter < maxIterations; iter++) {
    const newCentroids = updateCentroids(data, assignments, k);
    const newAssignments = assignToClusters(data, newCentroids);
    
    // Check for convergence
    const centroidShift = centroids.reduce((sum, c, i) => 
      sum + euclideanDistance(c, newCentroids[i]), 0
    );
    
    centroids = newCentroids;
    assignments = newAssignments;
    
    if (centroidShift < tolerance) break;
  }
  
  // Build cluster results
  const clusters: ClusterResult[] = centroids.map((centroid, i) => ({
    clusterId: i,
    centroid,
    members: []
  }));
  
  data.forEach((point, i) => {
    const clusterId = assignments[i];
    // Strict bounds check and type validation to prevent prototype pollution
    if (typeof clusterId === 'number' &&
        Number.isInteger(clusterId) && 
        clusterId >= 0 && 
        clusterId < k && 
        Object.prototype.hasOwnProperty.call(clusters, clusterId) &&
        clusters[clusterId]) {
      clusters[clusterId].members.push({
        id: String(i),
        values: point,
        distance: euclideanDistance(point, centroids[clusterId])
      });
    }
  });
  
  return clusters;
}

// ============================================================================
// Linear Regression for Trend Analysis
// ============================================================================

function linearRegression(x: number[], y: number[]): TrendResult {
  const n = Math.min(x.length, y.length);
  if (n < 2) {
    return {
      slope: 0,
      intercept: y[0] ?? 0,
      rSquared: 0,
      trend: 'stable',
      confidence: 0
    };
  }
  
  const xMean = mean(x.slice(0, n));
  const yMean = mean(y.slice(0, n));
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean);
    denominator += Math.pow(x[i] - xMean, 2);
  }
  
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  
  // Calculate R-squared
  const yPred = x.slice(0, n).map(xi => slope * xi + intercept);
  const ssRes = y.slice(0, n).reduce((sum, yi, i) => sum + Math.pow(yi - yPred[i], 2), 0);
  const ssTot = y.slice(0, n).reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
  const rSquared = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  
  // Determine trend
  const slopeThreshold = 0.01 * standardDeviation(y.slice(0, n));
  let trend: 'increasing' | 'decreasing' | 'stable';
  if (slope > slopeThreshold) {
    trend = 'increasing';
  } else if (slope < -slopeThreshold) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }
  
  return {
    slope,
    intercept,
    rSquared,
    trend,
    confidence: rSquared
  };
}

function predictValues(
  regression: TrendResult,
  futureX: number[]
): number[] {
  return futureX.map(x => regression.slope * x + regression.intercept);
}

// ============================================================================
// Experiment Feature Extraction
// ============================================================================

interface ExperimentFeatures {
  id: string;
  title: string;
  numericFeatures: number[];
  categoricalFeatures: Record<string, string>;
  outcome?: string;
}

async function extractExperimentFeatures(
  experimentIds?: string[]
): Promise<ExperimentFeatures[]> {
  const whereClause = experimentIds 
    ? { id: { in: experimentIds } }
    : {};
  
  const experiments = await prisma.experiment.findMany({
    where: whereClause,
    include: {
      stockUsages: true,
      signatures: true,
      comments: true
    }
  });
  
  return experiments.map((exp: any) => {
    // Extract numeric features from experiment content
    // Prisma JSON fields are already parsed objects
    const params = (exp.params ?? {}) as Record<string, unknown>;
    const observations = (exp.observations ?? {}) as Record<string, unknown>;
    const numericFeatures: number[] = [];
    const categoricalFeatures: Record<string, string> = {};
    
    // Duration based on created/updated time
    const createdTime = new Date(exp.createdAt).getTime();
    const updatedTime = new Date(exp.updatedAt).getTime();
    const duration = (updatedTime - createdTime) / (1000 * 60 * 60 * 24); // days
    numericFeatures.push(duration);
    
    // Number of signatures
    numericFeatures.push(exp.signatures?.length ?? 0);
    
    // Number of stocks/materials used
    numericFeatures.push(exp.stockUsages?.length ?? 0);
    
    // Number of comments
    numericFeatures.push(exp.comments?.length ?? 0);
    
    // Version number
    numericFeatures.push(exp.version);
    
    // Extract any numeric values from params
    function extractNumbers(obj: unknown, depth = 0): void {
      if (depth > 5) return;
      if (typeof obj === 'number' && isFinite(obj)) {
        numericFeatures.push(obj);
      } else if (Array.isArray(obj)) {
        obj.forEach(item => extractNumbers(item, depth + 1));
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(val => extractNumbers(val, depth + 1));
      }
    }
    extractNumbers(params);
    
    // ============================================================
    // INFORMATICS INTEGRATION: Extract features from datasets
    // ============================================================
    const datasets = (observations.datasets ?? []) as any[];
    if (datasets.length > 0) {
      // Add dataset count as a feature
      numericFeatures.push(datasets.length);
      
      // Extract statistics from each dataset
      for (const dataset of datasets) {
        if (dataset.statistics?.summary) {
          for (const [column, summary] of Object.entries(dataset.statistics.summary)) {
            const columnSummary = summary as any;
            if (columnSummary.type === 'numeric') {
              // Add mean values as features (useful for ML)
              if (typeof columnSummary.mean === 'number' && isFinite(columnSummary.mean)) {
                numericFeatures.push(columnSummary.mean);
              }
              // Add range as feature
              if (typeof columnSummary.min === 'number' && typeof columnSummary.max === 'number') {
                numericFeatures.push(columnSummary.max - columnSummary.min);
              }
            }
          }
        }
        // Record count can indicate experiment complexity
        if (typeof dataset.recordCount === 'number') {
          numericFeatures.push(dataset.recordCount);
        }
      }
      
      // Track dataset types as categorical
      const datasetTypes = datasets.map(d => d.type).filter(Boolean);
      if (datasetTypes.length > 0) {
        categoricalFeatures['datasetTypes'] = datasetTypes.join(',');
      }
    }
    
    // Status as categorical
    categoricalFeatures['status'] = exp.status;
    
    // Determine outcome (for prediction training)
    let outcome = 'unknown';
    if (exp.status === 'completed') {
      outcome = 'success';
    } else if (exp.status === 'archived') {
      outcome = 'completed';
    }
    
    return {
      id: exp.id,
      title: exp.title,
      numericFeatures,
      categoricalFeatures,
      outcome
    };
  });
}

// ============================================================================
// K-Nearest Neighbors for Prediction
// ============================================================================

interface KNNOptions {
  k: number;
  distanceMetric?: 'euclidean' | 'cosine';
}

function knnPredict(
  trainingData: ExperimentFeatures[],
  testPoint: number[],
  options: KNNOptions
): PredictionResult {
  const { k, distanceMetric = 'euclidean' } = options;
  
  // Calculate distances to all training points
  const distances = trainingData
    .filter(exp => exp.numericFeatures.length > 0 && exp.outcome !== 'unknown')
    .map(exp => {
      // Normalize feature vectors to same length
      const maxLen = Math.max(exp.numericFeatures.length, testPoint.length);
      const expFeatures = [...exp.numericFeatures, ...Array(maxLen - exp.numericFeatures.length).fill(0)];
      const testFeatures = [...testPoint, ...Array(maxLen - testPoint.length).fill(0)];
      
      const dist = distanceMetric === 'cosine'
        ? 1 - cosineSimilarity(expFeatures, testFeatures)
        : euclideanDistance(expFeatures, testFeatures);
      
      return {
        experiment: exp,
        distance: dist,
        similarity: 1 / (1 + dist)
      };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
  
  if (distances.length === 0) {
    return {
      predictedOutcome: 'unknown',
      confidence: 0,
      factors: [],
      similarExperiments: []
    };
  }
  
  // Vote on outcome
  const outcomeCounts: Record<string, number> = {};
  let totalWeight = 0;
  
  distances.forEach(d => {
    const weight = d.similarity;
    const outcome = d.experiment.outcome ?? 'unknown';
    outcomeCounts[outcome] = (outcomeCounts[outcome] ?? 0) + weight;
    totalWeight += weight;
  });
  
  const predictedOutcome = Object.entries(outcomeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  
  const confidence = totalWeight > 0 
    ? (outcomeCounts[predictedOutcome] ?? 0) / totalWeight 
    : 0;
  
  return {
    predictedOutcome,
    confidence,
    factors: [
      { name: 'numMethods', importance: 0.3, value: testPoint[1] ?? 0 },
      { name: 'numStocks', importance: 0.25, value: testPoint[2] ?? 0 },
      { name: 'numEntries', importance: 0.25, value: testPoint[3] ?? 0 },
      { name: 'duration', importance: 0.2, value: testPoint[0] ?? 0 }
    ],
    similarExperiments: distances.slice(0, 5).map(d => ({
      id: d.experiment.id,
      title: d.experiment.title,
      outcome: d.experiment.outcome ?? 'unknown',
      similarity: d.similarity
    }))
  };
}

// ============================================================================
// Python ML Integration (Optional)
// ============================================================================

interface PythonMLResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

async function runPythonML(
  script: string,
  data: unknown
): Promise<PythonMLResult> {
  return new Promise((resolve) => {
    // Create temp file for data
    const tempDir = os.tmpdir();
    const dataFile = path.join(tempDir, `enotebook_ml_${Date.now()}.json`);
    const scriptFile = path.join(tempDir, `enotebook_ml_${Date.now()}.py`);
    
    try {
      fs.writeFileSync(dataFile, JSON.stringify(data));
      fs.writeFileSync(scriptFile, script);
      
      const python = spawn('python', [scriptFile, dataFile], {
        timeout: 60000
      });
      
      let stdout = '';
      let stderr = '';
      
      python.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      python.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      python.on('error', () => {
        resolve({
          success: false,
          error: 'Python not available. Using built-in analytics.'
        });
      });
      
      python.on('close', (code) => {
        // Cleanup temp files
        try {
          fs.unlinkSync(dataFile);
          fs.unlinkSync(scriptFile);
        } catch {
          // Ignore cleanup errors
        }
        
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve({ success: true, result });
          } catch {
            resolve({ success: true, result: stdout });
          }
        } else {
          resolve({
            success: false,
            error: stderr || `Python process exited with code ${code}`
          });
        }
      });
    } catch (error) {
      resolve({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

// ============================================================================
// ML Analytics Service Class
// ============================================================================

export class MLAnalyticsService {
  /**
   * Detect outliers in experimental measurements
   */
  async detectOutliers(
    data: NumericData,
    method: 'zscore' | 'iqr' | 'mad' = 'zscore',
    threshold?: number
  ): Promise<{
    outliers: OutlierResult[];
    summary: {
      total: number;
      outlierCount: number;
      outlierPercentage: number;
      method: string;
    };
  }> {
    let outliers: OutlierResult[];
    
    switch (method) {
      case 'iqr':
        outliers = detectOutliersIQR(data, threshold ?? 1.5);
        break;
      case 'mad':
        outliers = detectOutliersMAD(data, threshold ?? 3.5);
        break;
      case 'zscore':
      default:
        outliers = detectOutliersZScore(data, threshold ?? 3.0);
    }
    
    const outlierCount = outliers.filter(o => o.isOutlier).length;
    
    return {
      outliers,
      summary: {
        total: data.values.length,
        outlierCount,
        outlierPercentage: data.values.length > 0 
          ? (outlierCount / data.values.length) * 100 
          : 0,
        method
      }
    };
  }
  
  /**
   * Cluster experiments by similarity
   */
  async clusterExperiments(
    experimentIds?: string[],
    k: number = 3
  ): Promise<{
    clusters: ClusterResult[];
    experiments: ExperimentFeatures[];
  }> {
    const features = await extractExperimentFeatures(experimentIds);
    
    // Prepare data matrix (normalize features)
    const data = features
      .filter(f => f.numericFeatures.length > 0)
      .map(f => {
        // Pad/truncate to consistent length
        const maxLen = 10;
        return [...f.numericFeatures.slice(0, maxLen), 
          ...Array(Math.max(0, maxLen - f.numericFeatures.length)).fill(0)];
      });
    
    if (data.length < k) {
      return { clusters: [], experiments: features };
    }
    
    // Normalize data
    const normalized = normalizeData(data);
    
    const clusters = kMeans(normalized, { k, maxIterations: 100 });
    
    // Map experiment IDs back to clusters
    const validFeatures = features.filter(f => f.numericFeatures.length > 0);
    clusters.forEach(cluster => {
      cluster.members = cluster.members.map(member => ({
        ...member,
        id: validFeatures[parseInt(member.id)]?.id ?? member.id
      }));
    });
    
    return { clusters, experiments: features };
  }
  
  /**
   * Analyze trends in time-series data
   */
  async analyzeTrends(
    data: { timestamp: number; value: number }[],
    forecastPeriods: number = 5
  ): Promise<TrendResult & { forecast: Array<{ timestamp: number; value: number }> }> {
    const sortedData = [...data].sort((a, b) => a.timestamp - b.timestamp);
    const x = sortedData.map((_, i) => i);
    const y = sortedData.map(d => d.value);
    
    const regression = linearRegression(x, y);
    
    // Generate forecast
    const lastTimestamp = sortedData[sortedData.length - 1]?.timestamp ?? Date.now();
    const interval = sortedData.length > 1
      ? (lastTimestamp - sortedData[0].timestamp) / (sortedData.length - 1)
      : 86400000; // Default 1 day
    
    const forecastX = Array.from(
      { length: forecastPeriods },
      (_, i) => x.length + i
    );
    const forecastY = predictValues(regression, forecastX);
    
    const forecast = forecastY.map((value, i) => ({
      timestamp: lastTimestamp + interval * (i + 1),
      value
    }));
    
    return { ...regression, forecast };
  }
  
  /**
   * Predict experiment outcome based on similar experiments
   */
  async predictOutcome(
    experimentId: string
  ): Promise<PredictionResult> {
    // Get all experiments for training
    const allFeatures = await extractExperimentFeatures();
    
    // Get target experiment features
    const targetFeatures = await extractExperimentFeatures([experimentId]);
    const target = targetFeatures[0];
    
    if (!target) {
      return {
        predictedOutcome: 'unknown',
        confidence: 0,
        factors: [],
        similarExperiments: []
      };
    }
    
    // Remove target from training set
    const trainingData = allFeatures.filter(f => f.id !== experimentId);
    
    // Pad features to consistent length
    const maxLen = 10;
    const testPoint = [
      ...target.numericFeatures.slice(0, maxLen),
      ...Array(Math.max(0, maxLen - target.numericFeatures.length)).fill(0)
    ];
    
    return knnPredict(trainingData, testPoint, { k: 5, distanceMetric: 'euclidean' });
  }
  
  /**
   * Compute correlation matrix for experiment variables
   */
  async computeCorrelations(
    experimentIds?: string[]
  ): Promise<{
    variables: string[];
    matrix: number[][];
  }> {
    const features = await extractExperimentFeatures(experimentIds);
    
    // Extract named variables
    const variables = ['duration', 'numMethods', 'numStocks', 'numEntries'];
    const data: number[][] = features
      .filter(f => f.numericFeatures.length >= 4)
      .map(f => f.numericFeatures.slice(0, 4));
    
    if (data.length < 2) {
      return {
        variables,
        matrix: variables.map(() => variables.map(() => 0))
      };
    }
    
    // Transpose to get columns
    const columns = variables.map((_, i) => data.map(row => row[i]));
    
    // Compute correlation matrix
    const matrix = columns.map((col1, i) =>
      columns.map((col2, j) => i === j ? 1 : correlation(col1, col2))
    );
    
    return { variables, matrix };
  }
  
  /**
   * Run advanced ML analysis using Python (if available)
   */
  async advancedAnalysis(
    analysisType: 'pca' | 'random_forest' | 'neural_network',
    experimentIds?: string[]
  ): Promise<PythonMLResult> {
    const features = await extractExperimentFeatures(experimentIds);
    
    const scripts: Record<string, string> = {
      pca: `
import json
import sys
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
import numpy as np

with open(sys.argv[1]) as f:
    data = json.load(f)

X = np.array([exp['numericFeatures'][:10] + [0]*(10-len(exp['numericFeatures'][:10])) 
              for exp in data if len(exp['numericFeatures']) > 0])

if len(X) < 2:
    print(json.dumps({'error': 'Insufficient data'}))
else:
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    pca = PCA(n_components=min(3, len(X[0]), len(X)))
    X_pca = pca.fit_transform(X_scaled)
    
    result = {
        'explained_variance': pca.explained_variance_ratio_.tolist(),
        'components': X_pca.tolist(),
        'loadings': pca.components_.tolist()
    }
    print(json.dumps(result))
`,
      random_forest: `
import json
import sys
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
import numpy as np

with open(sys.argv[1]) as f:
    data = json.load(f)

X = []
y = []
for exp in data:
    if len(exp['numericFeatures']) > 0 and exp.get('outcome', 'unknown') != 'unknown':
        features = exp['numericFeatures'][:10] + [0]*(10-len(exp['numericFeatures'][:10]))
        X.append(features)
        y.append(exp['outcome'])

if len(X) < 5:
    print(json.dumps({'error': 'Insufficient labeled data'}))
else:
    le = LabelEncoder()
    y_encoded = le.fit_transform(y)
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X_scaled, y_encoded)
    
    result = {
        'feature_importance': rf.feature_importances_.tolist(),
        'classes': le.classes_.tolist(),
        'accuracy': rf.score(X_scaled, y_encoded)
    }
    print(json.dumps(result))
`,
      neural_network: `
import json
import sys

try:
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    import numpy as np
    
    with open(sys.argv[1]) as f:
        data = json.load(f)
    
    X = []
    y = []
    for exp in data:
        if len(exp['numericFeatures']) > 0 and exp.get('outcome', 'unknown') != 'unknown':
            features = exp['numericFeatures'][:10] + [0]*(10-len(exp['numericFeatures'][:10]))
            X.append(features)
            y.append(exp['outcome'])
    
    if len(X) < 10:
        print(json.dumps({'error': 'Insufficient data for neural network'}))
    else:
        le = LabelEncoder()
        y_encoded = le.fit_transform(y)
        
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        mlp = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=500, random_state=42)
        mlp.fit(X_scaled, y_encoded)
        
        result = {
            'classes': le.classes_.tolist(),
            'accuracy': mlp.score(X_scaled, y_encoded),
            'layers': mlp.n_layers_
        }
        print(json.dumps(result))
except ImportError as e:
    print(json.dumps({'error': f'Missing dependency: {str(e)}'}))
`
    };
    
    const script = scripts[analysisType];
    if (!script) {
      return { success: false, error: 'Unknown analysis type' };
    }
    
    return runPythonML(script, features);
  }
}

// Helper function to normalize data
function normalizeData(data: number[][]): number[][] {
  if (data.length === 0) return data;
  
  const dims = data[0].length;
  const mins: number[] = Array(dims).fill(Infinity);
  const maxs: number[] = Array(dims).fill(-Infinity);
  
  data.forEach(row => {
    row.forEach((val, i) => {
      mins[i] = Math.min(mins[i], val);
      maxs[i] = Math.max(maxs[i], val);
    });
  });
  
  return data.map(row =>
    row.map((val, i) => {
      const range = maxs[i] - mins[i];
      return range === 0 ? 0 : (val - mins[i]) / range;
    })
  );
}

// ============================================================================
// Express Routes
// ============================================================================

export function createMLAnalyticsRoutes(): Router {
  const router = Router();
  const mlService = new MLAnalyticsService();
  
  /**
   * Detect outliers in measurement data
   * POST /api/ml/outliers
   */
  router.post('/outliers', async (req: Request, res: Response) => {
    try {
      const { values, labels, method, threshold } = req.body;
      
      if (!Array.isArray(values) || values.length === 0) {
        return res.status(400).json({ error: 'Values array is required' });
      }
      
      // Sanitize input - only allow finite numbers
      const sanitizedValues = values
        .filter((v: unknown): v is number => typeof v === 'number' && isFinite(v));
      
      if (sanitizedValues.length === 0) {
        return res.status(400).json({ error: 'No valid numeric values provided' });
      }
      
      // Sanitize labels if provided
      const sanitizedLabels = Array.isArray(labels) 
        ? labels.map((l: unknown) => String(l ?? ''))
        : undefined;
      
      // Validate method
      const validMethods = ['zscore', 'iqr', 'mad'];
      const sanitizedMethod = validMethods.includes(method) ? method : 'zscore';
      
      // Validate threshold
      const sanitizedThreshold = typeof threshold === 'number' && isFinite(threshold) && threshold > 0
        ? threshold
        : undefined;
      
      const result = await mlService.detectOutliers(
        { values: sanitizedValues, labels: sanitizedLabels },
        sanitizedMethod,
        sanitizedThreshold
      );
      
      res.json(result);
    } catch (error) {
      console.error('Outlier detection error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Outlier detection failed' 
      });
    }
  });
  
  /**
   * Cluster experiments by similarity
   * POST /api/ml/cluster
   */
  router.post('/cluster', async (req: Request, res: Response) => {
    try {
      const { experimentIds, k } = req.body;
      
      // Sanitize experimentIds - only allow valid UUID strings
      const sanitizedIds = Array.isArray(experimentIds)
        ? experimentIds.filter((id: unknown): id is string => 
            typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id))
        : undefined;
      
      // Sanitize k - must be positive integer between 1 and 100
      const sanitizedK = typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= 100
        ? k
        : 3;
      
      const result = await mlService.clusterExperiments(
        sanitizedIds,
        sanitizedK
      );
      
      res.json(result);
    } catch (error) {
      console.error('Clustering error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Clustering failed' 
      });
    }
  });
  
  /**
   * Analyze trends in time-series data
   * POST /api/ml/trends
   */
  router.post('/trends', async (req: Request, res: Response) => {
    try {
      const { data, forecastPeriods } = req.body;
      
      if (!Array.isArray(data) || data.length < 2) {
        return res.status(400).json({ 
          error: 'Data array with at least 2 points is required' 
        });
      }
      
      const result = await mlService.analyzeTrends(data, forecastPeriods ?? 5);
      
      res.json(result);
    } catch (error) {
      console.error('Trend analysis error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Trend analysis failed' 
      });
    }
  });
  
  /**
   * Predict experiment outcome
   * GET /api/ml/predict/:experimentId
   */
  router.get('/predict/:experimentId', async (req: Request, res: Response) => {
    try {
      const { experimentId } = req.params;
      
      const result = await mlService.predictOutcome(experimentId);
      
      res.json(result);
    } catch (error) {
      console.error('Prediction error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Prediction failed' 
      });
    }
  });
  
  /**
   * Get correlation matrix
   * POST /api/ml/correlations
   */
  router.post('/correlations', async (req: Request, res: Response) => {
    try {
      const { experimentIds } = req.body;
      
      const result = await mlService.computeCorrelations(experimentIds);
      
      res.json(result);
    } catch (error) {
      console.error('Correlation error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Correlation analysis failed' 
      });
    }
  });
  
  /**
   * Run advanced Python ML analysis
   * POST /api/ml/advanced
   */
  router.post('/advanced', async (req: Request, res: Response) => {
    try {
      const { analysisType, experimentIds } = req.body;
      
      if (!['pca', 'random_forest', 'neural_network'].includes(analysisType)) {
        return res.status(400).json({ 
          error: 'Invalid analysis type. Use: pca, random_forest, or neural_network' 
        });
      }
      
      const result = await mlService.advancedAnalysis(analysisType, experimentIds);
      
      if (result.success) {
        res.json(result.result);
      } else {
        // Fall back to built-in analysis
        res.json({
          warning: result.error,
          fallback: true,
          message: 'Using built-in analytics. Install Python with scikit-learn for advanced features.'
        });
      }
    } catch (error) {
      console.error('Advanced analysis error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Advanced analysis failed' 
      });
    }
  });
  
  /**
   * Get statistics summary for experiment data
   * POST /api/ml/statistics
   */
  router.post('/statistics', async (req: Request, res: Response) => {
    try {
      const { values } = req.body;
      
      if (!Array.isArray(values) || values.length === 0) {
        return res.status(400).json({ error: 'Values array is required' });
      }
      
      const numericValues = values.filter(
        (v): v is number => typeof v === 'number' && isFinite(v)
      );
      
      if (numericValues.length === 0) {
        return res.status(400).json({ error: 'No valid numeric values' });
      }
      
      res.json({
        count: numericValues.length,
        mean: mean(numericValues),
        median: median(numericValues),
        standardDeviation: standardDeviation(numericValues),
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        range: Math.max(...numericValues) - Math.min(...numericValues),
        q1: percentile(numericValues, 25),
        q3: percentile(numericValues, 75),
        iqr: percentile(numericValues, 75) - percentile(numericValues, 25)
      });
    } catch (error) {
      console.error('Statistics error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Statistics calculation failed' 
      });
    }
  });
  
  return router;
}

export default { MLAnalyticsService, createMLAnalyticsRoutes };
