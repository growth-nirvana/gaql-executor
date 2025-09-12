# GAQL Library

A library for working with Google Ads Query Language (GAQL).

## Installation

```bash
npm install
```

## Development

### Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Development Mode

```bash
# Run the library in development mode with auto-restart
npm run dev

# Run the library normally
npm start
```

### Linting

```bash
# Check for linting errors
npm run lint

# Fix linting errors automatically
npm run lint:fix
```

## Project Structure

```
gaql-library/
├── src/                 # Source code
│   └── index.js        # Main entry point
├── tests/              # Test files
│   ├── setup.js       # Test setup
│   └── index.test.js  # Sample test
├── docs/              # Documentation
├── package.json       # Package configuration
├── jest.config.js     # Jest test configuration
├── .eslintrc.js       # ESLint configuration
└── README.md          # This file
```

## Usage

```javascript
const gaqlLibrary = require('./src/index');

// Your library usage will go here
```

## Pipeline Steps

### group-by.js

The `group-by.js` step provides powerful data aggregation and grouping capabilities for GAQL results. It supports grouping by dimensions, time bucketing, various aggregation functions, filtering, and sorting.

#### Basic Usage

```javascript
const { groupRows } = require('./src/group-by');

const results = groupRows(data, {
  by: ['campaign.id', 'campaign.name'],
  aggregates: {
    'metrics.cost_micros': { fn: 'SUM', as: 'total_cost' },
    'metrics.clicks': { fn: 'SUM', as: 'total_clicks' }
  }
});
```

#### Configuration Options

##### `by` (array, optional)
Dimensions to group by. Can include nested field paths.

```javascript
by: [
  'campaign.id',
  'campaign.name', 
  'campaign.bidding_strategy_type',
  'ad_group.id'
]
```

##### `timeBucket` (object, optional)
Time-based grouping configuration.

```javascript
timeBucket: {
  field: 'segments.date',           // Required: field containing date values
  granularity: 'WEEK',              // DAY, WEEK, MONTH, QUARTER, YEAR
  weekStartsOn: 1,                  // Optional: 0=Sunday, 1=Monday (default)
  as: 'timeBucket'                  // Optional: alias for the time bucket field
}
```

**Supported granularities:**
- `DAY`: Groups by individual days
- `WEEK`: Groups by weeks (defaults to Monday start)
- `MONTH`: Groups by calendar months
- `QUARTER`: Groups by quarters (Q1, Q2, Q3, Q4)
- `YEAR`: Groups by calendar years

##### `aggregates` (object, required)
Aggregation functions to apply to grouped data.

**Base Aggregations:**
```javascript
aggregates: {
  'metrics.cost_micros': { fn: 'SUM', as: 'total_cost' },
  'metrics.clicks': { fn: 'SUM', as: 'total_clicks' },
  'metrics.impressions': { fn: 'SUM', as: 'total_impressions' },
  'campaign.id': { fn: 'COUNT_DISTINCT', as: 'campaign_count' },
  'metrics.cost_micros': { fn: 'AVG', as: 'avg_cost' },
  'metrics.clicks': { fn: 'MIN', as: 'min_clicks' },
  'metrics.clicks': { fn: 'MAX', as: 'max_clicks' }
}
```

**Supported base functions:**
- `SUM`: Sum of numeric values
- `AVG`: Average of numeric values  
- `MIN`: Minimum value
- `MAX`: Maximum value
- `COUNT`: Count of rows
- `COUNT_DISTINCT`: Count of unique values

**Derived Aggregations:**
```javascript
aggregates: {
  // Convert micros to currency units
  'cost': { 
    fn: 'MICROS_TO_UNITS', 
    src: 'total_cost', 
    currency: 'USD', 
    as: 'cost_usd' 
  },
  
  // Calculate ratios
  'ctr': { 
    fn: 'RATIO', 
    num: 'total_clicks', 
    den: 'total_impressions', 
    as: 'ctr' 
  },
  'cpc': { 
    fn: 'RATIO', 
    num: 'cost_usd', 
    den: 'total_clicks', 
    as: 'cpc' 
  }
}
```

**Supported derived functions:**
- `RATIO`: Calculates numerator/denominator with safe division
- `MICROS_TO_UNITS`: Converts micros to currency units (divides by 1,000,000)

##### `where` (array, optional)
Pre-aggregation filtering conditions.

```javascript
where: [
  { field: 'campaign.status', op: '==', value: 'ENABLED' },
  { field: 'metrics.clicks', op: '>', value: 0 },
  { field: 'campaign.bidding_strategy_type', op: 'IN', value: ['TARGET_CPA', 'TARGET_ROAS'] }
]
```

**Supported operators:**
- `>`: Greater than
- `>=`: Greater than or equal
- `<`: Less than  
- `<=`: Less than or equal
- `==`: Equal to
- `!=`: Not equal to
- `IN`: Value in array
- `NOT IN`: Value not in array

##### `having` (array, optional)
Post-aggregation filtering conditions (applied after grouping).

```javascript
having: [
  { field: 'total_clicks', op: '>', value: 100 },
  { field: 'ctr', op: '>=', value: 0.02 }
]
```

##### `orderBy` (array, optional)
Sorting configuration.

```javascript
orderBy: [
  { field: 'total_cost', dir: 'DESC' },
  { field: 'campaign.name', dir: 'ASC' }
]
```

**Supported directions:**
- `ASC`: Ascending order
- `DESC`: Descending order

##### `limit` (number, optional)
Maximum number of results to return.

```javascript
limit: 50
```

##### `rollup` (boolean, optional)
Include a grand total row with aggregated values across all groups.

```javascript
rollup: true
```

##### `nulls` (string, optional)
How to handle null values in grouping dimensions.

```javascript
nulls: 'exclude'  // Default: exclude rows with null dimension values
nulls: 'include'  // Include rows with null dimension values
```

#### Complete Example

```javascript
const { groupRows } = require('./src/group-by');

const results = groupRows(campaignData, {
  by: ['campaign.id', 'campaign.name'],
  timeBucket: {
    field: 'segments.date',
    granularity: 'WEEK',
    weekStartsOn: 1,
    as: 'week'
  },
  aggregates: {
    'metrics.cost_micros': { fn: 'SUM', as: 'total_cost_micros' },
    'metrics.clicks': { fn: 'SUM', as: 'total_clicks' },
    'metrics.impressions': { fn: 'SUM', as: 'total_impressions' },
    'cost_usd': { 
      fn: 'MICROS_TO_UNITS', 
      src: 'total_cost_micros', 
      as: 'cost_usd' 
    },
    'ctr': { 
      fn: 'RATIO', 
      num: 'total_clicks', 
      den: 'total_impressions', 
      as: 'ctr' 
    },
    'cpc': { 
      fn: 'RATIO', 
      num: 'cost_usd', 
      den: 'total_clicks', 
      as: 'cpc' 
    }
  },
  where: [
    { field: 'campaign.status', op: '==', value: 'ENABLED' }
  ],
  having: [
    { field: 'total_clicks', op: '>', value: 10 }
  ],
  orderBy: [
    { field: 'cost_usd', dir: 'DESC' }
  ],
  limit: 100,
  rollup: true,
  nulls: 'exclude'
});
```

#### Output Format

The function returns an array of objects with:
- Grouping dimension values
- Aggregated metric values
- Time bucket values (if configured)
- Rollup row with `__rollup: true` (if enabled)

```javascript
[
  {
    'campaign.id': '123456789',
    'campaign.name': 'Summer Sale',
    'week': '2024-01-15',
    'total_cost_micros': 5000000,
    'total_clicks': 150,
    'total_impressions': 5000,
    'cost_usd': 5.00,
    'ctr': 0.03,
    'cpc': 0.033
  },
  // ... more groups
  {
    'week': 'ALL',
    'total_cost_micros': 25000000,
    'total_clicks': 750,
    'total_impressions': 25000,
    'cost_usd': 25.00,
    'ctr': 0.03,
    'cpc': 0.033,
    '__rollup': true
  }
]
```

## License

MIT

