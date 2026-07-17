-- H06 / #101: reusable furniture components (puerta, entrepaño, …)
-- H07 / #102: module_component_refs attaches components to modules

CREATE TABLE IF NOT EXISTS furniture_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(50) NOT NULL DEFAULT 'otro',
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS component_board_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id UUID NOT NULL REFERENCES furniture_components(id) ON DELETE CASCADE,
    code VARCHAR(50),
    description VARCHAR(255) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    length_mm INT NOT NULL CHECK (length_mm > 0),
    width_mm INT NOT NULL CHECK (width_mm > 0),
    option_role VARCHAR(50) NOT NULL,
    edge_l1 BOOLEAN NOT NULL DEFAULT false,
    edge_l2 BOOLEAN NOT NULL DEFAULT false,
    edge_w1 BOOLEAN NOT NULL DEFAULT false,
    edge_w2 BOOLEAN NOT NULL DEFAULT false,
    length_formula VARCHAR(100),
    width_formula VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_component_board_parts_component_id
    ON component_board_parts(component_id);

CREATE TABLE IF NOT EXISTS component_hardware_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id UUID NOT NULL REFERENCES furniture_components(id) ON DELETE CASCADE,
    quantity INT NOT NULL CHECK (quantity > 0),
    description_override VARCHAR(255),
    option_role VARCHAR(50) NOT NULL DEFAULT '',
    hardware_id UUID
);

CREATE INDEX IF NOT EXISTS idx_component_hardware_lines_component_id
    ON component_hardware_lines(component_id);

CREATE TABLE IF NOT EXISTS module_component_refs (
    module_id UUID NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    component_id UUID NOT NULL REFERENCES furniture_components(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    sort_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (module_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_module_component_refs_component_id
    ON module_component_refs(component_id);
