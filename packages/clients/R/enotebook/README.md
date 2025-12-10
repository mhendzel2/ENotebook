# ENotebook R Client

R package for the ENotebook Electronic Lab Notebook API with tidyverse-friendly functions.

## Installation

```r
# Install from local source
install.packages("path/to/enotebook", repos = NULL, type = "source")

# Or with devtools
devtools::install_local("path/to/enotebook")
```

## Quick Start

```r
library(enotebook)

# Connect to ENotebook server
conn <- eln_connect("http://localhost:4000", api_key = "your-api-key")

# Check connection
eln_health(conn)
```

## Working with Experiments

### List and Filter Experiments

```r
# Get all experiments as a tibble
experiments <- eln_experiments(conn)

# Filter by status
completed <- eln_experiments(conn, status = "completed")

# Filter by modality
wet_lab <- eln_experiments(conn, modality = "wetLab")

# Use with dplyr
library(dplyr)

experiments %>%
  filter(modality == "wetLab", status == "completed") %>%
  arrange(desc(created_at)) %>%
  select(title, project, results_summary)
```

### Create Experiment

```r
exp <- eln_create_experiment(
  conn,
  title = "Cell Viability Assay",
  modality = "wetLab",
  project = "Drug Screening",
  params = list(
    cell_line = "HeLa",
    compound = "Compound A",
    concentrations = c(0.1, 1, 10, 100)  # µM
  ),
  tags = c("viability", "drug-screening", "hela")
)

cat("Created experiment:", exp$id, "\n")
```

### Update with Results

```r
# After running your experiment and analysis
eln_update_experiment(
  conn, exp$id,
  observations = list(
    viability_pct = c(98, 85, 45, 12),
    ic50 = 5.2,
    r_squared = 0.98
  ),
  results_summary = "IC50 = 5.2 µM with R² = 0.98",
  status = "completed"
)
```

## Extract and Analyze Data

### Get Observations as Data Frame

```r
# Extract observations from multiple experiments
obs <- eln_observations(conn, c("exp-1", "exp-2", "exp-3"))

# Analyze with ggplot2
library(ggplot2)

ggplot(obs, aes(x = concentration, y = viability, color = experiment_id)) +
  geom_point() +
  geom_smooth(method = "loess") +
  scale_x_log10() +
  labs(title = "Dose-Response Curves", x = "Concentration (µM)", y = "Viability (%)")
```

### Push Analysis Results Back

```r
# Perform analysis in R
data <- eln_observations(conn, "exp-123")

# Fit dose-response model
library(drc)
model <- drm(viability ~ concentration, data = data, fct = LL.4())

# Push results back to ELN
eln_push_results(conn, "exp-123",
  results = list(
    ic50 = ED(model, 50)[1],
    hill_slope = coef(model)[1],
    model_type = "4-parameter log-logistic"
  ),
  summary = sprintf("IC50 = %.2f µM (4PL model)", ED(model, 50)[1])
)
```

## Inventory Management

```r
# List all stocks
stocks <- eln_stocks(conn)

# Get low stock alerts
low <- eln_low_stocks(conn)

# Update quantity after use
eln_update_stock(conn, "stock-id", quantity = 45.5)
```

## GraphQL Queries

For complex queries:

```r
# Custom GraphQL query
result <- eln_graphql(conn, '
  query {
    experiments(status: "completed", limit: 10) {
      id
      title
      project
      signatures {
        type
        timestamp
        user { name }
      }
    }
  }
')

# Get statistics
stats <- eln_statistics(conn)
cat("Total experiments:", stats$totalExperiments, "\n")
cat("Low stock items:", stats$lowStockCount, "\n")
```

## Workflows

```r
# List workflows
workflows <- eln_workflows(conn)

# Get active workflows
active <- eln_workflows(conn, is_active = TRUE)

# Trigger workflow manually
eln_trigger_workflow(conn, "workflow-id", data = list(param1 = "value"))
```

## Analytics

```r
# Detect outliers
outliers <- eln_detect_outliers(
  conn,
  experiment_ids = c("exp-1", "exp-2", "exp-3"),
  field = "observations.ct_values",
  method = "zscore",
  threshold = 2.5
)

# Cluster experiments
clusters <- eln_cluster_experiments(
  conn,
  experiment_ids = c("exp-1", "exp-2", "exp-3", "exp-4"),
  features = c("params.temperature", "params.ph"),
  n_clusters = 3
)
```

## License

MIT License
