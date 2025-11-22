import { EscrowJob, EscrowAlgo } from '../types';

// Proxy is needed for local browser development due to CORS. 
const BASE_URL = 'https://hashes.com/en/api';
const USE_PROXY = true; 

const getUrl = (endpoint: string) => {
  const url = `${BASE_URL}${endpoint}`;
  // corsproxy.io handles both GET and POST
  return USE_PROXY ? `https://corsproxy.io/?${encodeURIComponent(url)}` : url;
};

export const getEscrowJobs = async (apiKey: string): Promise<EscrowJob[]> => {
  if (!apiKey) throw new Error("API Key required");

  try {
    const url = getUrl(`/jobs?key=${apiKey}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.success && Array.isArray(data.list)) {
      return data.list;
    } else if (data.message) {
      throw new Error(data.message);
    }
    
    return [];
  } catch (error) {
    console.error("Hashes.com API Error:", error);
    throw error;
  }
};

export const getAlgorithms = async (): Promise<EscrowAlgo[]> => {
  try {
    const url = getUrl(`/algorithms`);
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.success && Array.isArray(data.list)) {
      return data.list;
    }
    return [];
  } catch (e) {
    console.warn("Failed to fetch algorithms", e);
    return [];
  }
};

// Support string content OR File object
export const submitFoundHash = async (apiKey: string, algoId: number, content: string | File) => {
  const url = getUrl('/founds');
  const formData = new FormData();
  
  formData.append('key', apiKey);
  formData.append('algo', algoId.toString());
  
  if (content instanceof File) {
    formData.append('userfile', content);
  } else {
    // Create a file blob from the content string
    const blob = new Blob([content], { type: 'text/plain' });
    formData.append('userfile', blob, 'founds.txt');
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
     throw new Error(`Submission Error: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || "Unknown error during submission");
  }
  return result;
};

export const generateBatchDownloadList = (jobs: EscrowJob[]) => {
  // leftList is relative path: /unfound/6-1674174070-532062d5-unfound.txt
  return jobs.map(j => `https://hashes.com${j.leftList}`).join('\n');
};