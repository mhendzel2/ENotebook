# ENotebook Python Client

Python client library for the ENotebook Electronic Lab Notebook API.

## Installation

```bash
pip install enotebook

# With pandas support
pip install enotebook[pandas]

# With full analytics support
pip install enotebook[full]
```

## Quick Start

```python
from enotebook import ENotebookClient

# Connect to ENotebook server
client = ENotebookClient('http://localhost:4000', api_key='your-api-key')

# Check connection
health = client.health_check()
print(f"Server status: {health['status']}")
```

## Working with Experiments

### List Experiments

```python
# Get all experiments
experiments = client.experiments.list()

# Filter by status
completed = client.experiments.list(status='completed')

# Filter by modality
wet_lab = client.experiments.list(modality='wetLab')

# Convert to pandas DataFrame
df = experiments.to_dataframe()
print(df.head())
```

### Create Experiment

```python
# Create a new experiment
exp = client.experiments.create(
    title='PCR Amplification Test',
    modality='wetLab',
    project='Gene Expression Study',
    params={
        'cycles': 30,
        'denaturation_temp': 95,
        'annealing_temp': 55,
        'extension_temp': 72,
    },
    tags=['pcr', 'gene-expression']
)

print(f"Created experiment: {exp.id}")
```

### Update Experiment

```python
# Update experiment with observations
client.experiments.update(
    experiment_id=exp.id,
    observations={
        'ct_values': [25.3, 26.1, 24.8, 25.5],
        'quality_score': 0.95,
    },
    results_summary='Amplification successful with average Ct of 25.4'
)

# Change status
client.experiments.update(exp.id, status='completed')
```

### Sign Experiment

```python
# Add electronic signature
client.experiments.sign(
    experiment_id=exp.id,
    signature_type='author',
    meaning='I confirm this data is accurate'
)
```

## Working with Methods

```python
# List available methods
methods = client.methods.list()

# Get method by ID
method = client.methods.get('method-id')

# Create a new method
new_method = client.methods.create(
    title='Standard PCR Protocol',
    category='molecular-biology',
    steps=[
        {'order': 1, 'description': 'Prepare master mix', 'duration': '10 min'},
        {'order': 2, 'description': 'Add template DNA', 'duration': '5 min'},
        {'order': 3, 'description': 'Run thermocycler', 'duration': '2 hours'},
    ],
    reagents=[
        {'name': 'Taq Polymerase', 'amount': '0.5 µL'},
        {'name': 'dNTPs', 'amount': '1 µL'},
        {'name': '10x Buffer', 'amount': '5 µL'},
    ]
)
```

## Inventory Management

```python
# List all stocks
stocks = client.inventory.list_stocks()

# Get low stock alerts
low_stocks = client.inventory.low_stock_report()

# Update stock quantity
client.inventory.update_quantity('stock-id', quantity=45.5)
```

## Workflow Automation

```python
# List workflows
workflows = client.workflows.list()

# Create a workflow
workflow = client.workflows.create(
    name='Auto-archive completed experiments',
    trigger_type='experiment_completed',
    description='Automatically archive experiments after completion'
)

# Add a step
client.workflows.add_step(
    workflow_id=workflow['id'],
    action_type='update_status',
    action_config={'status': 'archived'},
    order=1
)

# Manually trigger
client.workflows.trigger(workflow['id'])
```

## GraphQL Queries

For complex queries, use the GraphQL API:

```python
# Simple query
result = client.graphql.query('''
    query {
        experiments(status: "completed", limit: 10) {
            id
            title
            project
            user {
                name
            }
        }
    }
''')

# Get statistics
stats = client.graphql.get_statistics()
print(f"Total experiments: {stats['totalExperiments']}")
print(f"Low stock items: {stats['lowStockCount']}")

# Query with variables
result = client.graphql.query('''
    query GetExperiment($id: ID!) {
        experiment(id: $id) {
            title
            status
            signatures {
                type
                timestamp
                user { name }
            }
        }
    }
''', variables={'id': 'experiment-123'})
```

## Analytics (Optional ML Features)

```python
# Detect outliers in experiment data
outliers = client.analytics.detect_outliers(
    experiment_ids=['exp-1', 'exp-2', 'exp-3'],
    field='observations.ct_values',
    method='zscore',
    threshold=2.0
)

# Cluster experiments
clusters = client.analytics.cluster_experiments(
    experiment_ids=['exp-1', 'exp-2', 'exp-3', 'exp-4'],
    features=['params.temperature', 'params.duration'],
    n_clusters=3
)

# Get prediction from trained model
prediction = client.analytics.predict_outcome(
    model_name='yield_predictor',
    features={'temperature': 37, 'ph': 7.4, 'duration': 120}
)
```

## Error Handling

```python
from enotebook import ENotebookClient, APIError

client = ENotebookClient('http://localhost:4000', api_key='your-key')

try:
    exp = client.experiments.get('non-existent-id')
except APIError as e:
    print(f"API Error: {e}")
    print(f"Status code: {e.status_code}")
```

## Authentication

### API Key (Recommended)

```python
client = ENotebookClient(
    'http://localhost:4000',
    api_key='your-api-key'
)
```

### User ID (Development)

```python
client = ENotebookClient(
    'http://localhost:4000',
    user_id='user-uuid'
)
```

## License

MIT License
