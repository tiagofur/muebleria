#!/usr/bin/env python3
"""Add #496 furniture/definitions, layout, and authoring/resolve endpoints to
granete-api.v1.yaml.  Run once; idempotent (re-running prints ALREADY_PRESENT
and exits 0 without modifying the file).

Usage:
    python3 scripts/add_496_contract.py [--check]

Options:
    --check   Verify the endpoints are present; exit 1 if not (drift gate use).
"""
import json
import sys
import os

SPEC_PATH = os.path.join(os.path.dirname(__file__), "..", "contracts", "openapi", "granete-api.v1.yaml")
TARGET_PATHS = [
    "/furniture/definitions",
    "/furniture/definitions/{definitionId}/layout",
    "/furniture/authoring/resolve",
]
TARGET_SCHEMAS = ["WorkshopFurnitureCatalogEnvelope", "WorkshopFurnitureDefinition",
                  "WorkshopMaterialRole", "WorkshopFurniturePreset",
                  "WorkshopFurnitureCategory", "WorkshopMaterialCategory",
                  "WorkshopMaterial", "FurnitureDefinitionLayout",
                  "LayoutComponent", "LayoutHardware", "LayoutTransform",
                  "LayoutBasis", "LayoutLocalTransform", "LayoutAuthoringCapability",
                  "AuthoringResolveRequest", "AuthoringResolveResponse",
                  "AuthoringResolveSource", "AuthoringResolveUnits",
                  "AuthoringResolveCoordinateSystem", "AuthoringResolveFurniture",
                  "AuthoringOccurrence", "AuthoringOccurrenceTransform",
                  "AuthoringPlacement", "AuthoringResolveResolved",
                  "AuthoringResolvePreflight", "NormalizedAuthoringIntent",
                  "ContractIssue"]

check_only = "--check" in sys.argv

with open(SPEC_PATH) as f:
    spec = json.load(f)

already_paths = all(p in spec["paths"] for p in TARGET_PATHS)
already_schemas = all(s in spec["components"]["schemas"] for s in TARGET_SCHEMAS)

if check_only:
    missing_paths = [p for p in TARGET_PATHS if p not in spec["paths"]]
    missing_schemas = [s for s in TARGET_SCHEMAS if s not in spec["components"]["schemas"]]
    if missing_paths or missing_schemas:
        print("DRIFT DETECTED — missing from granete-api.v1.yaml:")
        for p in missing_paths:
            print(f"  path: {p}")
        for s in missing_schemas:
            print(f"  schema: {s}")
        sys.exit(1)
    print("OK — all #496 endpoints and schemas present")
    sys.exit(0)

if already_paths and already_schemas:
    print("ALREADY_PRESENT — nothing to do")
    sys.exit(0)

# ── New paths ──────────────────────────────────────────────────────────────────
# Note: existing paths in this spec use plain description for 401/403/404 error
# responses (no content body), matching how the Go handlers respond for simple
# GET endpoints.  Only the resolve endpoint echoes the full envelope on all
# codes (the contract guarantee).
new_paths = {
    "/furniture/definitions": {
        "get": {
            "operationId": "listFurnitureDefinitions",
            "summary": "Workshop furniture catalog for SketchUp (granete.workshopFurnitureCatalog.v1)",
            "description": (
                "Serves the workshop's authoritative furniture catalog to authenticated "
                "extension clients. Requires an active workshop license. The response is "
                "the shared furniture contract envelope (schemaId, revisionId, definitions "
                "map, presets list, categories tree, materials list) projected from the same "
                "module rows the React app edits under /catalog/modules — there is no second "
                "furniture list. The revisionId is a deterministic hash of the entire "
                "projection; clients must carry it in every authoring/resolve request as "
                "furniture.catalogRevision (no implicit latest). Cache-Control: private, "
                "max-age=300; supports conditional GET via ETag / If-None-Match."
            ),
            "security": [{"BearerAuth": []}],
            "responses": {
                "200": {
                    "description": "Workshop furniture catalog envelope",
                    "headers": {
                        "ETag": {"schema": {"type": "string"}, "description": "Deterministic revisionId quoted as ETag"},
                        "Cache-Control": {"schema": {"type": "string"}}
                    },
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/WorkshopFurnitureCatalogEnvelope"}
                        }
                    }
                },
                "304": {"description": "Not Modified (If-None-Match matched the current ETag)"},
                "401": {"description": "Missing or invalid token"},
                "403": {"description": "Workshop license inactive"}
            }
        }
    },
    "/furniture/definitions/{definitionId}/layout": {
        "get": {
            "operationId": "getFurnitureDefinitionLayout",
            "summary": "Resolve furniture definition to full visual layout at concrete dimensions",
            "description": (
                "Resolves one workshop furniture definition (a module row) into its complete "
                "visual composition at concrete dimensions: every board component of the "
                "structure/module/agregados plus visible hardware placements (handles with "
                "preview geometry, hinges, ...). All geometry is computed server-side "
                "(formulas, poses, AABBs); clients like the SketchUp extension only transform "
                "pre-baked boxes — they never compute composition. Query parameters "
                "widthMm/heightMm/depthMm override the module's own dimensions (each optional, "
                "must be > 0 when present). Board choices ride in choice.ROLE=<materialId> "
                "query params (extension tokens are read-only)."
            ),
            "security": [{"BearerAuth": []}],
            "parameters": [
                {
                    "name": "definitionId",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string"},
                    "description": "Furniture definition UUID (furnitureDefinitionId from the catalog)"
                },
                {"name": "widthMm", "in": "query", "required": False, "schema": {"type": "integer", "minimum": 1}, "description": "Width override in millimeters"},
                {"name": "heightMm", "in": "query", "required": False, "schema": {"type": "integer", "minimum": 1}, "description": "Height override in millimeters"},
                {"name": "depthMm", "in": "query", "required": False, "schema": {"type": "integer", "minimum": 1}, "description": "Depth override in millimeters"}
            ],
            "responses": {
                "200": {
                    "description": "Resolved furniture layout",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/FurnitureDefinitionLayout"}}}
                },
                "400": {"description": "Invalid dimension query parameter"},
                "401": {"description": "Missing or invalid token"},
                "403": {"description": "Workshop license inactive"},
                "404": {"description": "Definition not found"},
                "422": {"description": "Definition resolves with geometry errors"}
            }
        }
    },
    "/furniture/authoring/resolve": {
        "post": {
            "operationId": "resolveAuthoringLayout",
            "summary": "Stateless semantic authoring resolve (granete.sketchup-authoring-resolve.v1)",
            "description": (
                "#477 — the versioned rich authoring resolve boundary. SketchUp submits a "
                "structured semantic authoring snapshot (occurrences, relationship/joint intent, "
                "manual hardware placements — granete.sketchup-authoring-resolve.v1) and Granete "
                "returns the authoritative accepted/resolved result: native layout with exact "
                "occurrence identities, machining with provenance, deterministic fingerprint, "
                "structured preflight issues and stable error codes. "
                "STATELESS: identical requests return identical responses and no "
                "Project/FurnitureInstance business record is created. "
                "POST is deliberate: authoring intent is a structured body (not query params). "
                "No query parameters accepted — any query parameter present fails closed. "
                "Max body: 2 MiB. Clients branch on issue codes, never on message substrings."
            ),
            "security": [{"BearerAuth": []}],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {"$ref": "#/components/schemas/AuthoringResolveRequest"}
                    }
                }
            },
            "responses": {
                "200": {
                    "description": "Resolve accepted — layout, machining and preflight present",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "400": {
                    "description": "Request invalid (schema mismatch, missing fields, query params present, trailing JSON)",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "401": {
                    "description": "Missing or invalid token",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "403": {
                    "description": "Workshop license inactive",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "405": {
                    "description": "Method not allowed (only POST accepted)",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "413": {
                    "description": "Payload exceeds 2 MiB",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "415": {
                    "description": "Content-Type must be application/json",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                },
                "422": {
                    "description": "Resolve rejected — catalog stale, parameter invalid, geometry error, or material choice invalid",
                    "content": {"application/json": {"schema": {"$ref": "#/components/schemas/AuthoringResolveResponse"}}}
                }
            }
        }
    }
}

# ── New schemas ────────────────────────────────────────────────────────────────
new_schemas = {
    "ContractIssue": {
        "type": "object",
        "description": (
            "Structured stable-code error/issue shape of the SketchUp authoring contracts "
            "(#346/#477). Clients branch on `code`, never on localized message substrings. "
            "Mirrors domain.ContractIssue in Go and ContractIssue in packages/domain."
        ),
        "required": ["code", "message", "severity"],
        "properties": {
            "code": {"type": "string", "description": "Stable machine-readable code; clients branch on this."},
            "message": {"type": "string", "description": "Human-readable description (may be localized; do NOT branch on it)."},
            "severity": {"type": "string", "enum": ["error", "warning", "info"], "description": "Issue severity level."},
            "entityId": {"type": "string", "description": "Affected entity ID, if applicable."},
            "path": {"type": "string", "description": "Dot-notation path to the offending field."},
            "remediation": {"type": "string", "description": "Actionable fix suggestion."},
            "details": {"type": "object", "additionalProperties": True, "description": "Arbitrary structured context."}
        }
    },
    "WorkshopFurnitureCatalogEnvelope": {
        "type": "object",
        "description": (
            "Workshop furniture catalog projection (granete.workshopFurnitureCatalog.v1). "
            "Source of truth for the SketchUp extension catalog; derived from the same module "
            "rows the React app edits under /catalog/modules."
        ),
        "required": ["schemaId", "revisionId", "categories", "materialCategories", "definitions", "presets", "materials"],
        "properties": {
            "schemaId": {"type": "string", "example": "granete.workshopFurnitureCatalog.v1"},
            "revisionId": {"type": "string", "description": "Deterministic SHA-256 hash of the whole projection. Carry as furniture.catalogRevision in every authoring/resolve request."},
            "categories": {"type": "array", "items": {"$ref": "#/components/schemas/WorkshopFurnitureCategory"}},
            "materialCategories": {"type": "array", "items": {"$ref": "#/components/schemas/WorkshopMaterialCategory"}},
            "definitions": {
                "type": "object",
                "additionalProperties": {"$ref": "#/components/schemas/WorkshopFurnitureDefinition"},
                "description": "Map of furnitureDefinitionId to definition"
            },
            "presets": {"type": "array", "items": {"$ref": "#/components/schemas/WorkshopFurniturePreset"}},
            "materials": {"type": "array", "items": {"$ref": "#/components/schemas/WorkshopMaterial"}}
        }
    },
    "WorkshopFurnitureDefinition": {
        "type": "object",
        "description": "One furniture definition as projected for the SketchUp extension (mirrors a module row).",
        "required": ["furnitureDefinitionId", "code", "name", "category", "version", "schemaRevision", "definitionHash", "parameters"],
        "properties": {
            "furnitureDefinitionId": {"type": "string"},
            "code": {"type": "string"},
            "name": {"type": "string"},
            "category": {"type": "string", "description": "Full catalog path (root > ... > leaf) for display."},
            "categoryId": {"type": "string"},
            "version": {"type": "string"},
            "schemaRevision": {"type": "integer"},
            "definitionHash": {"type": "string", "description": "SHA-256 of the published parameter set."},
            "description": {"type": "string"},
            "imageUrl": {"type": "string"},
            "parameters": {
                "type": "array",
                "items": {"$ref": "#/components/schemas/FurnitureParameterDefinition"}
            },
            "estimatedPartCount": {"type": "integer"},
            "estimatedHardwareCount": {"type": "integer"},
            "materialRoles": {"type": "array", "items": {"$ref": "#/components/schemas/WorkshopMaterialRole"}}
        }
    },
    "WorkshopMaterialRole": {
        "type": "object",
        "required": ["role", "label", "optionIds"],
        "properties": {
            "role": {"type": "string"},
            "label": {"type": "string"},
            "optionIds": {"type": "array", "items": {"type": "string"}}
        }
    },
    "WorkshopFurniturePreset": {
        "type": "object",
        "required": ["presetId", "name", "category", "furnitureDefinitionId", "parameters"],
        "properties": {
            "presetId": {"type": "string"},
            "name": {"type": "string"},
            "category": {"type": "string"},
            "furnitureDefinitionId": {"type": "string"},
            "parameters": {"type": "object", "additionalProperties": {"type": "integer"}}
        }
    },
    "WorkshopFurnitureCategory": {
        "type": "object",
        "required": ["categoryId", "name", "sortOrder"],
        "properties": {
            "categoryId": {"type": "string"},
            "name": {"type": "string"},
            "parentId": {"type": "string"},
            "sortOrder": {"type": "integer"}
        }
    },
    "WorkshopMaterialCategory": {
        "type": "object",
        "required": ["id", "name", "sortOrder"],
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "parentId": {"type": "string"},
            "sortOrder": {"type": "integer"}
        }
    },
    "WorkshopMaterial": {
        "type": "object",
        "description": "Board material for client material selectors (visual and PBR fields only — no pricing).",
        "required": ["materialId", "code", "name", "thicknessMm", "grain"],
        "properties": {
            "materialId": {"type": "string"},
            "code": {"type": "string"},
            "name": {"type": "string"},
            "manufacturer": {"type": "string"},
            "categoryId": {"type": "string"},
            "previewColor": {"type": "string"},
            "imageUrl": {"type": "string"},
            "previewTextureUrl": {"type": "string"},
            "previewTextureTileWidthMm": {"type": "number"},
            "previewTextureTileLengthMm": {"type": "number"},
            "previewRoughness": {"type": "number"},
            "previewMetalness": {"type": "number"},
            "previewClearcoat": {"type": "number"},
            "thicknessMm": {"type": "integer"},
            "grain": {"type": "boolean"}
        }
    },
    "FurnitureDefinitionLayout": {
        "type": "object",
        "description": (
            "Full resolved layout of one furniture definition at concrete dimensions. "
            "transformContract pins the local part transform representation (#414); clients "
            "must verify it before consuming components[].localTransform."
        ),
        "required": ["furnitureDefinitionId", "definitionName", "transformContract", "dimensionsMm", "components", "hardware"],
        "properties": {
            "furnitureDefinitionId": {"type": "string"},
            "definitionName": {"type": "string"},
            "transformContract": {"type": "string"},
            "dimensionsMm": {"type": "array", "items": {"type": "integer"}, "minItems": 3, "maxItems": 3},
            "components": {"type": "array", "items": {"$ref": "#/components/schemas/LayoutComponent"}},
            "hardware": {"type": "array", "items": {"$ref": "#/components/schemas/LayoutHardware"}}
        }
    },
    "LayoutTransform": {
        "type": "object",
        "required": ["translationMm", "basis"],
        "properties": {
            "translationMm": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "basis": {"$ref": "#/components/schemas/LayoutBasis"}
        }
    },
    "LayoutBasis": {
        "type": "object",
        "required": ["x", "y", "z"],
        "properties": {
            "x": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "y": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "z": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
        }
    },
    "LayoutLocalTransform": {
        "type": "object",
        "required": ["translationMm", "basis"],
        "properties": {
            "translationMm": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "basis": {"$ref": "#/components/schemas/LayoutBasis"},
            "movable": {"type": "boolean"},
            "axis": {"type": "string"}
        }
    },
    "LayoutAuthoringCapability": {
        "type": "object",
        "properties": {
            "movable": {"type": "boolean"},
            "axis": {"type": "string"}
        }
    },
    "LayoutComponent": {
        "type": "object",
        "required": ["componentInstanceId", "componentDefinitionId", "slotId", "name", "kind",
                     "transform", "dimensionsMm", "localTransform", "lengthMm", "widthMm", "thicknessMm"],
        "properties": {
            "componentInstanceId": {"type": "string"},
            "componentDefinitionId": {"type": "string"},
            "slotId": {"type": "string"},
            "role": {"type": "string"},
            "name": {"type": "string"},
            "kind": {"type": "string"},
            "transform": {"$ref": "#/components/schemas/LayoutTransform"},
            "dimensionsMm": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
            "localTransform": {"$ref": "#/components/schemas/LayoutLocalTransform"},
            "lengthMm": {"type": "integer"},
            "widthMm": {"type": "integer"},
            "thicknessMm": {"type": "integer"},
            "authoringCapability": {"$ref": "#/components/schemas/LayoutAuthoringCapability"},
            "optionRole": {"type": "string"},
            "materialId": {"type": "string"},
            "materialCode": {"type": "string"},
            "materialName": {"type": "string"},
            "materialColorHex": {"type": "string"},
            "materialImageUrl": {"type": "string"},
            "materialTextureUrl": {"type": "string"},
            "materialTextureTileWidthMm": {"type": "number"},
            "materialTextureTileLengthMm": {"type": "number"},
            "materialRoughness": {"type": "number"},
            "materialMetalness": {"type": "number"},
            "materialClearcoat": {"type": "number"},
            "materialGrain": {"type": "boolean"}
        }
    },
    "LayoutHardware": {
        "type": "object",
        "required": ["placementId", "hardwareId", "name", "shape"],
        "properties": {
            "placementId": {"type": "string"},
            "hardwareId": {"type": "string"},
            "name": {"type": "string"},
            "shape": {"type": "string"},
            "sizeMm": {"type": "number"},
            "diameterMm": {"type": "number"}
        }
    },
    # ── AuthoringResolve request shapes ────────────────────────────────────────
    "AuthoringResolveSource": {
        "type": "object",
        "required": ["client", "clientVersion", "host", "hostVersion"],
        "properties": {
            "client": {"type": "string", "maxLength": 128},
            "clientVersion": {"type": "string", "maxLength": 128},
            "host": {"type": "string", "maxLength": 128},
            "hostVersion": {"type": "string", "maxLength": 128}
        }
    },
    "AuthoringResolveUnits": {
        "type": "object",
        "required": ["length", "angle", "precisionMm"],
        "properties": {
            "length": {"type": "string", "enum": ["mm"]},
            "angle": {"type": "string", "enum": ["deg"]},
            "precisionMm": {"type": "number", "exclusiveMinimum": 0, "maximum": 1}
        }
    },
    "AuthoringResolveCoordinateSystem": {
        "type": "object",
        "required": ["handedness", "upAxis", "projectFrameId"],
        "properties": {
            "handedness": {"type": "string", "enum": ["right"]},
            "upAxis": {"type": "string", "enum": ["z"]},
            "projectFrameId": {"type": "string", "maxLength": 128}
        }
    },
    "AuthoringOccurrenceTransform": {
        "type": "object",
        "required": ["frame", "translationMm"],
        "properties": {
            "frame": {"type": "string", "enum": ["assembly"]},
            "translationMm": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
        }
    },
    "AuthoringOccurrence": {
        "type": "object",
        "required": ["componentInstanceId"],
        "properties": {
            "componentInstanceId": {"type": "string"},
            "componentDefinitionId": {"type": "string"},
            "catalogComponentId": {"type": "string"},
            "role": {"type": "string"},
            "transform": {"$ref": "#/components/schemas/AuthoringOccurrenceTransform"}
        }
    },
    "AuthoringPlacement": {
        "type": "object",
        "required": ["hardwarePlacementId", "catalogHardwareId", "hostComponentInstanceId", "anchorFace", "offsetMm"],
        "properties": {
            "hardwarePlacementId": {"type": "string"},
            "placementKind": {"type": "string"},
            "catalogHardwareId": {"type": "string"},
            "hostComponentInstanceId": {"type": "string"},
            "anchorFace": {"type": "string"},
            "offsetMm": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "rotationDeg": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "z": {"type": "number"}
                }
            }
        }
    },
    "AuthoringResolveFurniture": {
        "type": "object",
        "required": ["furnitureDefinitionId", "catalogRevision"],
        "properties": {
            "furnitureDefinitionId": {"type": "string", "maxLength": 128},
            "catalogRevision": {"type": "string", "maxLength": 128, "description": "revisionId from GET /furniture/definitions — required, no implicit latest."},
            "parameters": {"type": "object", "additionalProperties": True},
            "materialChoices": {"type": "object", "additionalProperties": {"type": "string"}},
            "components": {"type": "array", "items": {"$ref": "#/components/schemas/AuthoringOccurrence"}},
            "relationships": {"type": "array", "items": {"type": "object", "additionalProperties": True}},
            "hardwarePlacements": {"type": "array", "items": {"$ref": "#/components/schemas/AuthoringPlacement"}}
        }
    },
    "AuthoringResolveRequest": {
        "type": "object",
        "description": "granete.sketchup-authoring-resolve.v1 request body.",
        "required": ["schemaId", "schemaName", "schemaVersion", "messageId", "idempotencyKey", "sentAt", "source", "units", "coordinateSystem", "furniture"],
        "properties": {
            "schemaId": {"type": "string"},
            "schemaName": {"type": "string"},
            "schemaVersion": {"type": "string"},
            "messageId": {"type": "string", "maxLength": 128},
            "idempotencyKey": {"type": "string", "maxLength": 128},
            "sentAt": {"type": "string", "format": "date-time"},
            "source": {"$ref": "#/components/schemas/AuthoringResolveSource"},
            "units": {"$ref": "#/components/schemas/AuthoringResolveUnits"},
            "coordinateSystem": {"$ref": "#/components/schemas/AuthoringResolveCoordinateSystem"},
            "furniture": {"$ref": "#/components/schemas/AuthoringResolveFurniture"}
        }
    },
    "AuthoringResolvePreflight": {
        "type": "object",
        "required": ["scope", "status", "issues", "preflightContract"],
        "properties": {
            "scope": {"type": "string", "description": "Resolve-scoped validation subset, NOT the fabrication-readiness verdict."},
            "status": {"type": "string"},
            "issues": {"type": "array", "items": {"$ref": "#/components/schemas/ContractIssue"}},
            "preflightContract": {"type": "string"}
        }
    },
    "NormalizedAuthoringIntent": {
        "type": "object",
        "description": "Deterministic normalized snapshot of the authoring intent echoed on accepted resolves.",
        "additionalProperties": True
    },
    "AuthoringResolveResolved": {
        "type": "object",
        "required": ["layout", "machining", "preflight"],
        "properties": {
            "layout": {"$ref": "#/components/schemas/FurnitureDefinitionLayout"},
            "machining": {"type": "object", "additionalProperties": True, "description": "Authoring machining with provenance."},
            "preflight": {"$ref": "#/components/schemas/AuthoringResolvePreflight"}
        }
    },
    "AuthoringResolveResponse": {
        "type": "object",
        "description": (
            "Envelope returned for all status codes by POST /furniture/authoring/resolve. "
            "Clients branch on `status` (accepted/rejected) and issue `code`, never on "
            "message substrings or HTTP status alone."
        ),
        "required": ["schemaId", "schemaName", "schemaVersion", "resolveContract",
                     "responseMessageId", "inReplyToMessageId", "idempotencyKey",
                     "catalogRevision", "status", "issues"],
        "properties": {
            "schemaId": {"type": "string"},
            "schemaName": {"type": "string"},
            "schemaVersion": {"type": "string"},
            "resolveContract": {"type": "string"},
            "responseMessageId": {"type": "string"},
            "inReplyToMessageId": {"type": "string"},
            "idempotencyKey": {"type": "string"},
            "catalogRevision": {"type": "string"},
            "status": {"type": "string", "enum": ["accepted", "rejected"]},
            "normalizedSnapshot": {"$ref": "#/components/schemas/NormalizedAuthoringIntent"},
            "resolved": {"$ref": "#/components/schemas/AuthoringResolveResolved"},
            "issues": {"type": "array", "items": {"$ref": "#/components/schemas/ContractIssue"}}
        }
    }
}

# ── Mutate spec ────────────────────────────────────────────────────────────────
added_paths = 0
for path, definition in new_paths.items():
    if path not in spec["paths"]:
        spec["paths"][path] = definition
        added_paths += 1

added_schemas = 0
for name, schema in new_schemas.items():
    if name not in spec["components"]["schemas"]:
        spec["components"]["schemas"][name] = schema
        added_schemas += 1

with open(SPEC_PATH, "w") as f:
    json.dump(spec, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Done — added {added_paths} paths, {added_schemas} schemas to granete-api.v1.yaml")
