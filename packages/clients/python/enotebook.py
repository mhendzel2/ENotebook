"""
ENotebook Python Client Library

A Python SDK for programmatic access to the ENotebook Electronic Lab Notebook.
Allows scientists to extract experimental data, perform analysis, and push results back.

Features:
- REST and GraphQL API support
- Pandas DataFrame integration
- Experiment CRUD operations
- Inventory management
- Workflow automation
- Data export utilities

Example usage:
    from enotebook import ENotebookClient
    
    client = ENotebookClient('http://localhost:4000', api_key='your-api-key')
    
    # Get experiments as DataFrame
    experiments = client.experiments.list(status='completed')
    df = experiments.to_dataframe()
    
    # Create new experiment
    exp = client.experiments.create(
        title='PCR Analysis',
        modality='wetLab',
        params={'cycles': 30, 'temperature': 95}
    )
    
    # Update with results
    client.experiments.update(exp.id, observations={'ct_values': [25.3, 26.1, 24.8]})
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Union
import json
import urllib.request
import urllib.error
import urllib.parse

__version__ = '0.1.0'


@dataclass
class User:
    """Represents an ENotebook user."""
    id: str
    email: str
    name: Optional[str] = None
    role: str = 'researcher'


@dataclass
class Experiment:
    """Represents an experiment in the ELN."""
    id: str
    title: str
    user_id: str
    modality: str = 'wetLab'
    status: str = 'draft'
    project: Optional[str] = None
    protocol_ref: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    observations: Optional[Dict[str, Any]] = None
    results_summary: Optional[str] = None
    data_link: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    version: int = 1
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Experiment':
        """Create Experiment from API response dictionary."""
        return cls(
            id=data['id'],
            title=data['title'],
            user_id=data.get('userId', ''),
            modality=data.get('modality', 'wetLab'),
            status=data.get('status', 'draft'),
            project=data.get('project'),
            protocol_ref=data.get('protocolRef'),
            params=data.get('params') if isinstance(data.get('params'), dict) else None,
            observations=data.get('observations') if isinstance(data.get('observations'), dict) else None,
            results_summary=data.get('resultsSummary'),
            data_link=data.get('dataLink'),
            tags=data.get('tags', []),
            version=data.get('version', 1),
            created_at=data.get('createdAt'),
            updated_at=data.get('updatedAt'),
        )


@dataclass
class Method:
    """Represents a method/protocol template."""
    id: str
    title: str
    created_by: str
    category: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None
    reagents: Optional[List[Dict[str, Any]]] = None
    version: int = 1
    is_public: bool = True
    created_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Method':
        return cls(
            id=data['id'],
            title=data['title'],
            created_by=data.get('createdBy', ''),
            category=data.get('category'),
            steps=data.get('steps') if isinstance(data.get('steps'), list) else None,
            reagents=data.get('reagents') if isinstance(data.get('reagents'), list) else None,
            version=data.get('version', 1),
            is_public=data.get('isPublic', True),
            created_at=data.get('createdAt'),
        )


@dataclass
class Stock:
    """Represents an inventory stock item."""
    id: str
    item_id: str
    quantity: float
    initial_quantity: float
    unit: str
    status: str = 'available'
    location_id: Optional[str] = None
    lot_number: Optional[str] = None
    expiration_date: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Stock':
        return cls(
            id=data['id'],
            item_id=data.get('itemId', ''),
            quantity=data.get('quantity', 0),
            initial_quantity=data.get('initialQuantity', 0),
            unit=data.get('unit', ''),
            status=data.get('status', 'available'),
            location_id=data.get('locationId'),
            lot_number=data.get('lotNumber'),
            expiration_date=data.get('expirationDate'),
        )


class ExperimentCollection:
    """Collection of experiments with DataFrame conversion."""
    
    def __init__(self, experiments: List[Experiment]):
        self._experiments = experiments
    
    def __iter__(self):
        return iter(self._experiments)
    
    def __len__(self):
        return len(self._experiments)
    
    def __getitem__(self, index):
        return self._experiments[index]
    
    def to_dataframe(self):
        """Convert experiments to pandas DataFrame."""
        try:
            import pandas as pd
        except ImportError:
            raise ImportError("pandas is required for DataFrame conversion. Install with: pip install pandas")
        
        records = []
        for exp in self._experiments:
            record = {
                'id': exp.id,
                'title': exp.title,
                'user_id': exp.user_id,
                'modality': exp.modality,
                'status': exp.status,
                'project': exp.project,
                'protocol_ref': exp.protocol_ref,
                'results_summary': exp.results_summary,
                'tags': ','.join(exp.tags) if exp.tags else '',
                'version': exp.version,
                'created_at': exp.created_at,
                'updated_at': exp.updated_at,
            }
            # Flatten params
            if exp.params:
                for key, value in exp.params.items():
                    record[f'param_{key}'] = value
            # Flatten observations
            if exp.observations:
                for key, value in exp.observations.items():
                    record[f'obs_{key}'] = value
            records.append(record)
        
        return pd.DataFrame(records)
    
    def filter(self, **kwargs) -> 'ExperimentCollection':
        """Filter experiments by attributes."""
        filtered = []
        for exp in self._experiments:
            match = True
            for key, value in kwargs.items():
                if getattr(exp, key, None) != value:
                    match = False
                    break
            if match:
                filtered.append(exp)
        return ExperimentCollection(filtered)


class APIError(Exception):
    """Exception raised for API errors."""
    def __init__(self, message: str, status_code: int = None, response: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.response = response


class HTTPClient:
    """Low-level HTTP client for API requests."""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None, user_id: Optional[str] = None):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.user_id = user_id
    
    def _get_headers(self) -> Dict[str, str]:
        headers = {'Content-Type': 'application/json'}
        if self.api_key:
            headers['x-api-key'] = self.api_key
        elif self.user_id:
            headers['x-user-id'] = self.user_id
        return headers
    
    def request(self, method: str, path: str, data: Optional[Dict] = None) -> Any:
        """Make HTTP request to API."""
        url = f"{self.base_url}{path}"
        headers = self._get_headers()
        
        body = None
        if data:
            body = json.dumps(data).encode('utf-8')
        
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        
        try:
            with urllib.request.urlopen(req) as response:
                response_data = response.read().decode('utf-8')
                if response_data:
                    return json.loads(response_data)
                return None
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            try:
                error_data = json.loads(error_body)
                message = error_data.get('error', str(e))
            except:
                message = error_body or str(e)
            raise APIError(message, status_code=e.code, response=error_body)
        except urllib.error.URLError as e:
            raise APIError(f"Connection error: {e.reason}")
    
    def get(self, path: str, params: Optional[Dict] = None) -> Any:
        if params:
            query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
            path = f"{path}?{query}"
        return self.request('GET', path)
    
    def post(self, path: str, data: Dict) -> Any:
        return self.request('POST', path, data)
    
    def put(self, path: str, data: Dict) -> Any:
        return self.request('PUT', path, data)
    
    def patch(self, path: str, data: Dict) -> Any:
        return self.request('PATCH', path, data)
    
    def delete(self, path: str) -> Any:
        return self.request('DELETE', path)


class ExperimentsAPI:
    """API for experiment operations."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def list(
        self,
        status: Optional[str] = None,
        modality: Optional[str] = None,
        project: Optional[str] = None,
        limit: int = 100,
    ) -> ExperimentCollection:
        """List experiments with optional filters."""
        params = {'status': status, 'modality': modality, 'project': project, 'limit': limit}
        data = self._client.get('/experiments', params)
        experiments = [Experiment.from_dict(d) for d in data]
        return ExperimentCollection(experiments)
    
    def get(self, experiment_id: str) -> Experiment:
        """Get a single experiment by ID."""
        data = self._client.get(f'/experiments/{experiment_id}')
        return Experiment.from_dict(data)
    
    def create(
        self,
        title: str,
        modality: str = 'wetLab',
        project: Optional[str] = None,
        protocol_ref: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None,
        observations: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
        status: str = 'draft',
    ) -> Experiment:
        """Create a new experiment."""
        payload = {
            'title': title,
            'modality': modality,
            'status': status,
        }
        if project:
            payload['project'] = project
        if protocol_ref:
            payload['protocolRef'] = protocol_ref
        if params:
            payload['params'] = params
        if observations:
            payload['observations'] = observations
        if tags:
            payload['tags'] = tags
        
        data = self._client.post('/experiments', payload)
        return Experiment.from_dict(data)
    
    def update(
        self,
        experiment_id: str,
        title: Optional[str] = None,
        status: Optional[str] = None,
        params: Optional[Dict[str, Any]] = None,
        observations: Optional[Dict[str, Any]] = None,
        results_summary: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> Experiment:
        """Update an existing experiment."""
        payload = {}
        if title:
            payload['title'] = title
        if status:
            payload['status'] = status
        if params:
            payload['params'] = params
        if observations:
            payload['observations'] = observations
        if results_summary:
            payload['resultsSummary'] = results_summary
        if tags:
            payload['tags'] = tags
        
        data = self._client.patch(f'/experiments/{experiment_id}', payload)
        return Experiment.from_dict(data)
    
    def delete(self, experiment_id: str) -> bool:
        """Delete an experiment."""
        self._client.delete(f'/experiments/{experiment_id}')
        return True
    
    def sign(
        self,
        experiment_id: str,
        signature_type: str,
        meaning: Optional[str] = None,
        password: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add electronic signature to experiment."""
        payload = {'type': signature_type}
        if meaning:
            payload['meaning'] = meaning
        if password:
            payload['password'] = password
        return self._client.post(f'/api/signatures/experiments/{experiment_id}/sign', payload)
    
    def export(self, experiment_id: str, format: str = 'json') -> Any:
        """Export experiment data."""
        return self._client.get(f'/api/export/experiments/{experiment_id}', {'format': format})


class MethodsAPI:
    """API for method/protocol operations."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def list(self, category: Optional[str] = None, is_public: Optional[bool] = None) -> List[Method]:
        """List methods with optional filters."""
        params = {'category': category}
        if is_public is not None:
            params['isPublic'] = str(is_public).lower()
        data = self._client.get('/methods', params)
        return [Method.from_dict(d) for d in data]
    
    def get(self, method_id: str) -> Method:
        """Get a single method by ID."""
        data = self._client.get(f'/methods/{method_id}')
        return Method.from_dict(data)
    
    def create(
        self,
        title: str,
        steps: List[Dict[str, Any]],
        category: Optional[str] = None,
        reagents: Optional[List[Dict[str, Any]]] = None,
        is_public: bool = True,
    ) -> Method:
        """Create a new method."""
        payload = {
            'title': title,
            'steps': steps,
            'isPublic': is_public,
        }
        if category:
            payload['category'] = category
        if reagents:
            payload['reagents'] = reagents
        
        data = self._client.post('/methods', payload)
        return Method.from_dict(data)


class InventoryAPI:
    """API for inventory operations."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def list_items(self, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """List inventory items."""
        params = {'category': category}
        return self._client.get('/inventory', params)
    
    def list_stocks(
        self,
        status: Optional[str] = None,
        item_id: Optional[str] = None,
    ) -> List[Stock]:
        """List stocks with optional filters."""
        params = {'status': status, 'itemId': item_id}
        data = self._client.get('/inventory/stocks', params)
        return [Stock.from_dict(d) for d in data]
    
    def get_stock(self, stock_id: str) -> Stock:
        """Get a single stock by ID."""
        data = self._client.get(f'/inventory/stocks/{stock_id}')
        return Stock.from_dict(data)
    
    def update_quantity(self, stock_id: str, quantity: float) -> Stock:
        """Update stock quantity."""
        data = self._client.patch(f'/inventory/stocks/{stock_id}', {'quantity': quantity})
        return Stock.from_dict(data)
    
    def low_stock_report(self) -> List[Stock]:
        """Get stocks with low quantity."""
        data = self._client.get('/inventory/stocks', {'status': 'low'})
        return [Stock.from_dict(d) for d in data]


class WorkflowsAPI:
    """API for workflow automation."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def list(self, is_active: Optional[bool] = None) -> List[Dict[str, Any]]:
        """List workflows."""
        params = {}
        if is_active is not None:
            params['isActive'] = str(is_active).lower()
        return self._client.get('/api/workflows', params)
    
    def get(self, workflow_id: str) -> Dict[str, Any]:
        """Get a single workflow."""
        return self._client.get(f'/api/workflows/{workflow_id}')
    
    def create(
        self,
        name: str,
        trigger_type: str,
        trigger_config: Optional[Dict] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new workflow."""
        payload = {
            'name': name,
            'triggerType': trigger_type,
        }
        if trigger_config:
            payload['triggerConfig'] = trigger_config
        if description:
            payload['description'] = description
        return self._client.post('/api/workflows', payload)
    
    def add_step(
        self,
        workflow_id: str,
        action_type: str,
        action_config: Dict[str, Any],
        order: int = 0,
        condition: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Add a step to a workflow."""
        payload = {
            'actionType': action_type,
            'actionConfig': action_config,
            'order': order,
        }
        if condition:
            payload['condition'] = condition
        return self._client.post(f'/api/workflows/{workflow_id}/steps', payload)
    
    def trigger(self, workflow_id: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """Manually trigger a workflow."""
        return self._client.post(f'/api/workflows/{workflow_id}/trigger', data or {})


class GraphQLAPI:
    """GraphQL API client."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def query(self, query: str, variables: Optional[Dict] = None) -> Dict[str, Any]:
        """Execute a GraphQL query."""
        payload = {'query': query}
        if variables:
            payload['variables'] = variables
        return self._client.post('/api/graphql', payload)
    
    def get_experiments(
        self,
        fields: List[str] = None,
        status: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Query experiments via GraphQL."""
        if not fields:
            fields = ['id', 'title', 'status', 'modality', 'project', 'createdAt']
        
        query = f"""
        query GetExperiments($status: String, $limit: Int) {{
            experiments(status: $status, limit: $limit) {{
                {' '.join(fields)}
            }}
        }}
        """
        result = self.query(query, {'status': status, 'limit': limit})
        return result.get('data', {}).get('experiments', [])
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get overall statistics via GraphQL."""
        query = """
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
        """
        result = self.query(query)
        return result.get('data', {}).get('statistics', {})


class AnalyticsAPI:
    """API for analytics and ML features."""
    
    def __init__(self, client: HTTPClient):
        self._client = client
    
    def detect_outliers(
        self,
        experiment_ids: List[str],
        field: str,
        method: str = 'zscore',
        threshold: float = 2.0,
    ) -> Dict[str, Any]:
        """Detect outliers in experiment observations."""
        payload = {
            'experimentIds': experiment_ids,
            'field': field,
            'method': method,
            'threshold': threshold,
        }
        return self._client.post('/api/analytics/outliers', payload)
    
    def cluster_experiments(
        self,
        experiment_ids: List[str],
        features: List[str],
        n_clusters: int = 3,
        algorithm: str = 'kmeans',
    ) -> Dict[str, Any]:
        """Cluster experiments based on features."""
        payload = {
            'experimentIds': experiment_ids,
            'features': features,
            'nClusters': n_clusters,
            'algorithm': algorithm,
        }
        return self._client.post('/api/analytics/cluster', payload)
    
    def predict_outcome(
        self,
        model_name: str,
        features: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Get prediction from trained model."""
        payload = {
            'modelName': model_name,
            'features': features,
        }
        return self._client.post('/api/analytics/predict', payload)


class ENotebookClient:
    """
    Main client for ENotebook API.
    
    Example:
        client = ENotebookClient('http://localhost:4000', api_key='your-key')
        
        # List experiments
        experiments = client.experiments.list(status='completed')
        
        # Convert to DataFrame
        df = experiments.to_dataframe()
        
        # Use GraphQL
        stats = client.graphql.get_statistics()
    """
    
    def __init__(
        self,
        base_url: str = 'http://localhost:4000',
        api_key: Optional[str] = None,
        user_id: Optional[str] = None,
    ):
        """
        Initialize ENotebook client.
        
        Args:
            base_url: Base URL of the ENotebook server
            api_key: API key for authentication (preferred)
            user_id: User ID for simple header auth (fallback)
        """
        self._http = HTTPClient(base_url, api_key, user_id)
        
        # Initialize API modules
        self.experiments = ExperimentsAPI(self._http)
        self.methods = MethodsAPI(self._http)
        self.inventory = InventoryAPI(self._http)
        self.workflows = WorkflowsAPI(self._http)
        self.graphql = GraphQLAPI(self._http)
        self.analytics = AnalyticsAPI(self._http)
    
    def health_check(self) -> Dict[str, Any]:
        """Check server health."""
        return self._http.get('/health')
    
    def whoami(self) -> Optional[User]:
        """Get current authenticated user info."""
        try:
            # Use GraphQL to get current user
            result = self.graphql.query('query { me { id email name role } }')
            data = result.get('data', {}).get('me')
            if data:
                return User(**data)
        except:
            pass
        return None


# Convenience functions for quick access
def connect(
    base_url: str = 'http://localhost:4000',
    api_key: Optional[str] = None,
    user_id: Optional[str] = None,
) -> ENotebookClient:
    """
    Create and return an ENotebook client.
    
    Example:
        import enotebook
        client = enotebook.connect(api_key='your-key')
    """
    return ENotebookClient(base_url, api_key, user_id)


if __name__ == '__main__':
    # Example usage
    print("ENotebook Python Client v" + __version__)
    print("Usage: from enotebook import ENotebookClient")
    print("       client = ENotebookClient('http://localhost:4000', api_key='your-key')")
