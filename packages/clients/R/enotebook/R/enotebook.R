#' ENotebook R Client Library
#'
#' An R package for programmatic access to the ENotebook Electronic Lab Notebook.
#' Provides tidyverse-friendly functions for extracting experimental data,
#' performing analysis, and pushing results back to the ELN.
#'
#' @name enotebook
#' @docType package
#' @author ENotebook Team
#' @import httr
#' @import jsonlite
#' @importFrom tibble tibble as_tibble
#' @importFrom dplyr bind_rows mutate select filter
NULL

#' Create ENotebook API Connection
#'
#' Creates a connection object for interacting with ENotebook API.
#'
#' @param base_url Base URL of the ENotebook server (default: "http://localhost:4000")
#' @param api_key API key for authentication (recommended)
#' @param user_id User ID for simple auth (alternative to api_key)
#'
#' @return An enotebook_connection object
#' @export
#'
#' @examples
#' \dontrun{
#' conn <- eln_connect("http://localhost:4000", api_key = "your-key")
#' experiments <- eln_experiments(conn)
#' }
eln_connect <- function(base_url = "http://localhost:4000",
                        api_key = NULL,
                        user_id = NULL) {
  conn <- list(
    base_url = sub("/$", "", base_url),
    api_key = api_key,
    user_id = user_id
  )
  class(conn) <- "enotebook_connection"
  conn
}

#' Print method for connection
#' @export
print.enotebook_connection <- function(x, ...) {
  cat("ENotebook Connection\n")
  cat("  URL:", x$base_url, "\n")
  cat("  Auth:", ifelse(!is.null(x$api_key), "API Key", 
                        ifelse(!is.null(x$user_id), "User ID", "None")), "\n")
  invisible(x)
}

# Internal function to build headers
.eln_headers <- function(conn) {
  headers <- c("Content-Type" = "application/json")
  if (!is.null(conn$api_key)) {
    headers <- c(headers, "x-api-key" = conn$api_key)
  } else if (!is.null(conn$user_id)) {
    headers <- c(headers, "x-user-id" = conn$user_id)
  }
  headers
}

# Internal function to make API requests
.eln_request <- function(conn, method, path, body = NULL, query = NULL) {
  url <- paste0(conn$base_url, path)
  headers <- .eln_headers(conn)
  
  response <- switch(
    method,
    "GET" = httr::GET(url, httr::add_headers(.headers = headers), 
                      query = query),
    "POST" = httr::POST(url, httr::add_headers(.headers = headers),
                        body = jsonlite::toJSON(body, auto_unbox = TRUE),
                        encode = "raw"),
    "PATCH" = httr::PATCH(url, httr::add_headers(.headers = headers),
                          body = jsonlite::toJSON(body, auto_unbox = TRUE),
                          encode = "raw"),
    "PUT" = httr::PUT(url, httr::add_headers(.headers = headers),
                      body = jsonlite::toJSON(body, auto_unbox = TRUE),
                      encode = "raw"),
    "DELETE" = httr::DELETE(url, httr::add_headers(.headers = headers))
  )
  
  if (httr::http_error(response)) {
    error_content <- httr::content(response, "text", encoding = "UTF-8")
    stop(sprintf("API Error (%d): %s", 
                 httr::status_code(response), error_content))
  }
  
  content <- httr::content(response, "text", encoding = "UTF-8")
  if (nchar(content) > 0) {
    jsonlite::fromJSON(content, simplifyVector = FALSE)
  } else {
    NULL
  }
}

#' Check Server Health
#'
#' @param conn ENotebook connection object
#' @return List with server health status
#' @export
eln_health <- function(conn) {
  .eln_request(conn, "GET", "/health")
}

# ==================== EXPERIMENTS ====================

#' List Experiments
#'
#' Retrieve experiments from ENotebook as a tibble.
#'
#' @param conn ENotebook connection object
#' @param status Filter by status (draft, in_progress, completed, archived)
#' @param modality Filter by modality (wetLab, computational, fieldwork, etc.)
#' @param project Filter by project name
#' @param limit Maximum number of experiments to return
#'
#' @return A tibble of experiments
#' @export
#'
#' @examples
#' \dontrun{
#' conn <- eln_connect(api_key = "your-key")
#' 
#' # Get all experiments
#' experiments <- eln_experiments(conn)
#' 
#' # Get completed experiments
#' completed <- eln_experiments(conn, status = "completed")
#' 
#' # Use with dplyr
#' library(dplyr)
#' experiments %>%
#'   filter(modality == "wetLab") %>%
#'   arrange(desc(created_at))
#' }
eln_experiments <- function(conn, status = NULL, modality = NULL, 
                            project = NULL, limit = 100) {
  query <- list()
  if (!is.null(status)) query$status <- status
  if (!is.null(modality)) query$modality <- modality
  if (!is.null(project)) query$project <- project
  query$limit <- limit
  
  data <- .eln_request(conn, "GET", "/experiments", query = query)
  
  if (length(data) == 0) {
    return(tibble::tibble(
      id = character(),
      title = character(),
      status = character(),
      modality = character(),
      project = character(),
      user_id = character(),
      created_at = character()
    ))
  }
  
  # Convert to tibble
  experiments <- lapply(data, function(exp) {
    tibble::tibble(
      id = exp$id %||% NA_character_,
      title = exp$title %||% NA_character_,
      status = exp$status %||% NA_character_,
      modality = exp$modality %||% NA_character_,
      project = exp$project %||% NA_character_,
      protocol_ref = exp$protocolRef %||% NA_character_,
      results_summary = exp$resultsSummary %||% NA_character_,
      user_id = exp$userId %||% NA_character_,
      version = exp$version %||% NA_integer_,
      created_at = exp$createdAt %||% NA_character_,
      updated_at = exp$updatedAt %||% NA_character_
    )
  })
  
  dplyr::bind_rows(experiments)
}

#' Get Single Experiment
#'
#' @param conn ENotebook connection object
#' @param experiment_id Experiment ID
#' @return List with experiment details
#' @export
eln_experiment <- function(conn, experiment_id) {
  .eln_request(conn, "GET", paste0("/experiments/", experiment_id))
}

#' Create Experiment
#'
#' @param conn ENotebook connection object
#' @param title Experiment title
#' @param modality Experiment modality (default: "wetLab")
#' @param project Project name
#' @param params Named list of parameters
#' @param observations Named list of observations
#' @param tags Character vector of tags
#' @param status Initial status (default: "draft")
#'
#' @return List with created experiment
#' @export
#'
#' @examples
#' \dontrun{
#' conn <- eln_connect(api_key = "your-key")
#' 
#' exp <- eln_create_experiment(
#'   conn,
#'   title = "Cell Culture Growth Curve",
#'   modality = "wetLab",
#'   project = "Cancer Research",
#'   params = list(
#'     cell_line = "HeLa",
#'     seeding_density = 10000,
#'     media = "DMEM + 10% FBS"
#'   ),
#'   tags = c("cell-culture", "growth-curve")
#' )
#' }
eln_create_experiment <- function(conn, title, modality = "wetLab",
                                  project = NULL, params = NULL,
                                  observations = NULL, tags = NULL,
                                  status = "draft") {
  body <- list(
    title = title,
    modality = modality,
    status = status
  )
  if (!is.null(project)) body$project <- project
  if (!is.null(params)) body$params <- params
  if (!is.null(observations)) body$observations <- observations
  if (!is.null(tags)) body$tags <- as.list(tags)
  
  .eln_request(conn, "POST", "/experiments", body = body)
}

#' Update Experiment
#'
#' @param conn ENotebook connection object
#' @param experiment_id Experiment ID
#' @param ... Fields to update (title, status, params, observations, etc.)
#'
#' @return List with updated experiment
#' @export
#'
#' @examples
#' \dontrun{
#' # Update observations
#' eln_update_experiment(
#'   conn, "exp-123",
#'   observations = list(
#'     cell_counts = c(10000, 25000, 62000, 150000),
#'     viability = c(98, 97, 95, 93)
#'   ),
#'   results_summary = "Exponential growth observed over 4 days"
#' )
#' 
#' # Change status
#' eln_update_experiment(conn, "exp-123", status = "completed")
#' }
eln_update_experiment <- function(conn, experiment_id, ...) {
  body <- list(...)
  .eln_request(conn, "PATCH", paste0("/experiments/", experiment_id), body = body)
}

#' Delete Experiment
#'
#' @param conn ENotebook connection object
#' @param experiment_id Experiment ID
#' @return TRUE if successful
#' @export
eln_delete_experiment <- function(conn, experiment_id) {
  .eln_request(conn, "DELETE", paste0("/experiments/", experiment_id))
  TRUE
}

#' Extract Experiment Observations as Data Frame
#'
#' Extract observations from one or more experiments and combine into a tidy tibble.
#'
#' @param conn ENotebook connection object
#' @param experiment_ids Character vector of experiment IDs
#'
#' @return A tibble with experiment observations
#' @export
#'
#' @examples
#' \dontrun{
#' # Get observations from multiple experiments
#' obs <- eln_observations(conn, c("exp-1", "exp-2", "exp-3"))
#' 
#' # Analyze with ggplot2
#' library(ggplot2)
#' ggplot(obs, aes(x = timepoint, y = value, color = experiment_id)) +
#'   geom_line()
#' }
eln_observations <- function(conn, experiment_ids) {
  all_obs <- lapply(experiment_ids, function(exp_id) {
    exp <- eln_experiment(conn, exp_id)
    if (is.null(exp$observations)) return(NULL)
    
    obs <- exp$observations
    if (is.character(obs)) {
      obs <- jsonlite::fromJSON(obs)
    }
    
    # Convert to long format
    obs_df <- tryCatch({
      # Try to convert list to data frame
      df <- as.data.frame(obs)
      df$experiment_id <- exp_id
      df$experiment_title <- exp$title
      df
    }, error = function(e) {
      # Fall back to nested tibble
      tibble::tibble(
        experiment_id = exp_id,
        experiment_title = exp$title,
        observations = list(obs)
      )
    })
    
    obs_df
  })
  
  dplyr::bind_rows(all_obs)
}

# ==================== METHODS ====================

#' List Methods
#'
#' @param conn ENotebook connection object
#' @param category Filter by category
#'
#' @return A tibble of methods
#' @export
eln_methods <- function(conn, category = NULL) {
  query <- list()
  if (!is.null(category)) query$category <- category
  
  data <- .eln_request(conn, "GET", "/methods", query = query)
  
  if (length(data) == 0) {
    return(tibble::tibble(
      id = character(),
      title = character(),
      category = character(),
      version = integer(),
      is_public = logical()
    ))
  }
  
  methods <- lapply(data, function(m) {
    tibble::tibble(
      id = m$id %||% NA_character_,
      title = m$title %||% NA_character_,
      category = m$category %||% NA_character_,
      version = m$version %||% NA_integer_,
      is_public = m$isPublic %||% TRUE,
      created_by = m$createdBy %||% NA_character_,
      created_at = m$createdAt %||% NA_character_
    )
  })
  
  dplyr::bind_rows(methods)
}

#' Get Single Method
#'
#' @param conn ENotebook connection object
#' @param method_id Method ID
#' @return List with method details
#' @export
eln_method <- function(conn, method_id) {
  .eln_request(conn, "GET", paste0("/methods/", method_id))
}

# ==================== INVENTORY ====================

#' List Inventory Stocks
#'
#' @param conn ENotebook connection object
#' @param status Filter by status (available, low, empty, expired)
#' @param item_id Filter by inventory item ID
#'
#' @return A tibble of stocks
#' @export
eln_stocks <- function(conn, status = NULL, item_id = NULL) {
  query <- list()
  if (!is.null(status)) query$status <- status
  if (!is.null(item_id)) query$itemId <- item_id
  
  data <- .eln_request(conn, "GET", "/inventory/stocks", query = query)
  
  if (length(data) == 0) {
    return(tibble::tibble(
      id = character(),
      item_id = character(),
      quantity = numeric(),
      unit = character(),
      status = character()
    ))
  }
  
  stocks <- lapply(data, function(s) {
    tibble::tibble(
      id = s$id %||% NA_character_,
      item_id = s$itemId %||% NA_character_,
      quantity = s$quantity %||% NA_real_,
      initial_quantity = s$initialQuantity %||% NA_real_,
      unit = s$unit %||% NA_character_,
      status = s$status %||% NA_character_,
      location_id = s$locationId %||% NA_character_,
      lot_number = s$lotNumber %||% NA_character_,
      expiration_date = s$expirationDate %||% NA_character_
    )
  })
  
  dplyr::bind_rows(stocks)
}

#' Get Low Stock Report
#'
#' @param conn ENotebook connection object
#' @return A tibble of low and empty stocks
#' @export
eln_low_stocks <- function(conn) {
  low <- eln_stocks(conn, status = "low")
  empty <- eln_stocks(conn, status = "empty")
  dplyr::bind_rows(low, empty)
}

#' Update Stock Quantity
#'
#' @param conn ENotebook connection object
#' @param stock_id Stock ID
#' @param quantity New quantity
#'
#' @return List with updated stock
#' @export
eln_update_stock <- function(conn, stock_id, quantity) {
  .eln_request(conn, "PATCH", paste0("/inventory/stocks/", stock_id),
               body = list(quantity = quantity))
}

# ==================== GRAPHQL ====================

#' Execute GraphQL Query
#'
#' Execute arbitrary GraphQL queries against the ENotebook API.
#'
#' @param conn ENotebook connection object
#' @param query GraphQL query string
#' @param variables Named list of query variables
#'
#' @return Query result
#' @export
#'
#' @examples
#' \dontrun{
#' # Simple query
#' result <- eln_graphql(conn, '
#'   query {
#'     experiments(status: "completed", limit: 5) {
#'       id
#'       title
#'       user { name }
#'     }
#'   }
#' ')
#' 
#' # Query with variables
#' result <- eln_graphql(conn, '
#'   query GetExperiment($id: ID!) {
#'     experiment(id: $id) {
#'       title
#'       observations
#'       signatures { type timestamp }
#'     }
#'   }
#' ', variables = list(id = "exp-123"))
#' }
eln_graphql <- function(conn, query, variables = NULL) {
  body <- list(query = query)
  if (!is.null(variables)) body$variables <- variables
  
  .eln_request(conn, "POST", "/api/graphql", body = body)
}

#' Get Statistics via GraphQL
#'
#' @param conn ENotebook connection object
#' @return Named list of statistics
#' @export
eln_statistics <- function(conn) {
  result <- eln_graphql(conn, '
    query {
      statistics {
        totalExperiments
        totalMethods
        totalInventoryItems
        totalStocks
        lowStockCount
        activeWorkflows
        activePools
      }
    }
  ')
  
  result$data$statistics
}

# ==================== WORKFLOWS ====================

#' List Workflows
#'
#' @param conn ENotebook connection object
#' @param is_active Filter by active status
#'
#' @return A tibble of workflows
#' @export
eln_workflows <- function(conn, is_active = NULL) {
  query <- list()
  if (!is.null(is_active)) query$isActive <- tolower(as.character(is_active))
  
  data <- .eln_request(conn, "GET", "/api/workflows", query = query)
  
  if (length(data) == 0) {
    return(tibble::tibble(
      id = character(),
      name = character(),
      trigger_type = character(),
      is_active = logical()
    ))
  }
  
  workflows <- lapply(data, function(w) {
    tibble::tibble(
      id = w$id %||% NA_character_,
      name = w$name %||% NA_character_,
      description = w$description %||% NA_character_,
      trigger_type = w$triggerType %||% NA_character_,
      is_active = w$isActive %||% FALSE,
      created_at = w$createdAt %||% NA_character_
    )
  })
  
  dplyr::bind_rows(workflows)
}

#' Trigger Workflow
#'
#' @param conn ENotebook connection object
#' @param workflow_id Workflow ID
#' @param data Optional data to pass to workflow
#'
#' @return Workflow execution result
#' @export
eln_trigger_workflow <- function(conn, workflow_id, data = list()) {
  .eln_request(conn, "POST", paste0("/api/workflows/", workflow_id, "/trigger"),
               body = data)
}

# ==================== ANALYTICS ====================

#' Detect Outliers in Experiment Data
#'
#' @param conn ENotebook connection object
#' @param experiment_ids Character vector of experiment IDs
#' @param field Field name in observations to analyze
#' @param method Detection method: "zscore" or "iqr"
#' @param threshold Z-score threshold (default: 2.0)
#'
#' @return List with outlier analysis results
#' @export
eln_detect_outliers <- function(conn, experiment_ids, field,
                                 method = "zscore", threshold = 2.0) {
  body <- list(
    experimentIds = as.list(experiment_ids),
    field = field,
    method = method,
    threshold = threshold
  )
  
  .eln_request(conn, "POST", "/api/analytics/outliers", body = body)
}

#' Cluster Experiments
#'
#' @param conn ENotebook connection object
#' @param experiment_ids Character vector of experiment IDs
#' @param features Character vector of feature field names
#' @param n_clusters Number of clusters
#' @param algorithm Clustering algorithm: "kmeans" or "hierarchical"
#'
#' @return List with clustering results
#' @export
eln_cluster_experiments <- function(conn, experiment_ids, features,
                                     n_clusters = 3, algorithm = "kmeans") {
  body <- list(
    experimentIds = as.list(experiment_ids),
    features = as.list(features),
    nClusters = n_clusters,
    algorithm = algorithm
  )
  
  .eln_request(conn, "POST", "/api/analytics/cluster", body = body)
}

# ==================== UTILITIES ====================

#' Null coalescing operator
#' @keywords internal
`%||%` <- function(x, y) if (is.null(x)) y else x

#' Push Analysis Results to Experiment
#'
#' Convenience function to push R analysis results back to an experiment.
#'
#' @param conn ENotebook connection object
#' @param experiment_id Experiment ID
#' @param results Named list of analysis results
#' @param summary Text summary of results
#'
#' @return Updated experiment
#' @export
#'
#' @examples
#' \dontrun
#' # Perform analysis in R
#' data <- eln_observations(conn, "exp-123")
#' model <- lm(value ~ time, data = data)
#' 
#' # Push results back
#' eln_push_results(conn, "exp-123",
#'   results = list(
#'     r_squared = summary(model)$r.squared,
#'     coefficients = coef(model),
#'     p_value = summary(model)$coefficients[2, 4]
#'   ),
#'   summary = sprintf("Linear regression R² = %.3f", summary(model)$r.squared)
#' )
#' }
eln_push_results <- function(conn, experiment_id, results, summary = NULL) {
  # Get existing observations
  exp <- eln_experiment(conn, experiment_id)
  existing_obs <- exp$observations
  if (is.character(existing_obs)) {
    existing_obs <- jsonlite::fromJSON(existing_obs)
  }
  if (is.null(existing_obs)) existing_obs <- list()
  
  # Merge with new results
  existing_obs$analysis_results <- results
  existing_obs$analysis_timestamp <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ")
  
  # Update experiment
  body <- list(observations = existing_obs)
  if (!is.null(summary)) body$resultsSummary <- summary
  
  .eln_request(conn, "PATCH", paste0("/experiments/", experiment_id), body = body)
}

# Package info
.onAttach <- function(libname, pkgname) {
  packageStartupMessage("ENotebook R Client v0.1.0")
  packageStartupMessage("Connect with: conn <- eln_connect('http://localhost:4000', api_key = 'your-key')")
}
