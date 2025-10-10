# CSV Export Utility

A standalone utility for exporting query results to CSV format with automatic object flattening.

## Features

- ✅ **Automatic flattening** of nested objects using dot notation
- ✅ **Field selection** - choose which columns to include
- ✅ **Custom headers** - rename columns for better readability
- ✅ **Works with all integrations** - Google Ads, Facebook, etc.
- ✅ **Proper CSV escaping** - handles commas, quotes, newlines
- ✅ **Independent module** - doesn't pollute GAQLExecutor or pipeline

## Usage

### Basic Export (All Fields)

```javascript
const { GoogleAdsCampaignTemplate, GAQLExecutor, writeCsv } = require('@growth-nirvana/gaql-executor');

const result = await executor.execute();

// Write all fields to CSV
writeCsv(result, 'output/campaigns.csv', { flatten: true });
```

### Export Selected Fields

```javascript
writeCsv(result, 'output/campaigns.csv', {
  flatten: true,
  fields: [
    'campaign.name',
    'metrics.cost',
    'metrics.clicks',
    'metrics.impressions',
    'metrics.ctr',
  ]
});
```

### Export with Custom Headers

```javascript
writeCsv(result, 'output/campaigns.csv', {
  flatten: true,
  fields: ['campaign.name', 'metrics.cost', 'metrics.clicks'],
  headers: {
    'campaign.name': 'Campaign Name',
    'metrics.cost': 'Total Cost',
    'metrics.clicks': 'Total Clicks',
  }
});
```

### Get CSV String (Without Writing File)

```javascript
const { toCsv, resultsToCsv } = require('@growth-nirvana/gaql-executor');

// From results array
const csv = toCsv(result.results, { flatten: true });

// From envelope results
const csv = resultsToCsv(result, { flatten: true });

// Do something with the CSV string
console.log(csv);
// or send via HTTP, email, etc.
```

## API Reference

### `writeCsv(data, filePath, options)`

Write data to CSV file.

**Parameters:**
- `data` (Array|Object) - Results array or envelope object
- `filePath` (string) - Path to output file
- `options` (Object) - Conversion options

**Options:**
- `flatten` (boolean) - Flatten nested objects (default: `true`)
- `fields` (Array) - Array of field names to include (optional)
- `headers` (Object) - Map of field names to custom headers (optional)
- `includeHeaders` (boolean) - Include header row (default: `true`)

### `toCsv(data, options)`

Convert array of objects to CSV string.

**Returns:** CSV string

### `resultsToCsv(results, options)`

Convert results (envelope or array) to CSV string.

**Returns:** CSV string

### `flattenObject(obj, prefix, result)`

Flatten a nested object using dot notation.

**Example:**
```javascript
const { flattenObject } = require('@growth-nirvana/gaql-executor');

const obj = {
  campaign: { id: '123', name: 'Test' },
  metrics: { cost: 100, clicks: 50 }
};

const flat = flattenObject(obj);
// {
//   'campaign.id': '123',
//   'campaign.name': 'Test',
//   'metrics.cost': 100,
//   'metrics.clicks': 50
// }
```

## Object Flattening

Nested objects are flattened using dot notation:

```javascript
// Input
{
  campaign: {
    id: '12345',
    name: 'Summer Sale'
  },
  metrics: {
    cost: 1500.50,
    clicks: 450
  }
}

// Output CSV columns
campaign.id, campaign.name, metrics.cost, metrics.clicks
12345, Summer Sale, 1500.50, 450
```

## Array Handling

Arrays are stringified as JSON:

```javascript
{
  conversions: [1, 2, 3]
}

// CSV output
conversions
"[1,2,3]"
```

## Integration Examples

### Google Ads Campaigns

```javascript
const result = await GoogleAdsCampaignTemplate
  .forPerformanceAnalysis(credentials, fromDate, toDate)
  .execute();

writeCsv(result, 'campaigns.csv', { flatten: true });
```

### Facebook Campaigns

```javascript
const result = await FacebookCampaignTemplate
  .forPerformanceAnalysis(credentials, fromDate, toDate)
  .execute();

writeCsv(result, 'fb-campaigns.csv', { flatten: true });
```

### Multi-Account Results

Works seamlessly with multi-account queries:

```javascript
const credentials = {
  customerIds: ['123', '456', '789']
};

const result = await executor.execute();
writeCsv(result, 'multi-account.csv', { flatten: true });
```

## Complete Example

See `templates/google-campaigns-to-csv.js` for a working example.

