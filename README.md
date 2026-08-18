# Streaming HAR to CSV Converter

A high-performance utility designed to convert large HTTP Archive (HAR) files into CSV format. 

---

## How to Run

Make sure you have [Node.js](https://nodejs.org/) installed.

### 1. Web App
Run the local server to use the interactive web browser interface:
```bash
npm start
```
Then open your browser and navigate to:
```
http://localhost:8081
```

### 2. Node.js CLI Tool
Convert files directly in your terminal:
```bash
node har_to_csv.js <path-to-input.har> [path-to-output.csv]
```
