package api

import (
	"net/http"
)

// Contrato: compras/almacén (picking, stock, suppliers, purchase orders) y
// CRM del proyecto (fotos/showcase, mensajes, workflow, garantías).
func registerOperationsRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Compras/Almacén picking (Fase 3): project × material despacho state.
	// Read: admin/gerente_produccion/almacen; write: admin/almacen.
	mux.Handle("GET /api/picking", authMW(http.HandlerFunc(server.HandlePickingList)))
	mux.Handle("PUT /api/picking", authMW(http.HandlerFunc(server.HandlePickingUpsert)))

	// Compras/Almacén stock (Fase 3b): balances + mínimos + movement ledger.
	// Read: admin/gerente_produccion/almacen; write (movements/mínimos): admin/almacen.
	mux.Handle("GET /api/stock", authMW(http.HandlerFunc(server.HandleStockList)))
	mux.Handle("PUT /api/stock", authMW(http.HandlerFunc(server.HandleStockUpsertMin)))
	mux.Handle("POST /api/stock/movements", authMW(http.HandlerFunc(server.HandleStockMovementCreate)))
	mux.Handle("GET /api/stock/movements", authMW(http.HandlerFunc(server.HandleStockMovementsList)))

	// Compras/Almacén proveedores + órdenes de compra (Fase 3c). Reads: workspace
	// roles; writes (create/edit/emit/cancel/receive): admin/almacen.
	mux.Handle("GET /api/suppliers", authMW(http.HandlerFunc(server.HandleSuppliers)))
	mux.Handle("POST /api/suppliers", authMW(http.HandlerFunc(server.HandleSuppliers)))
	mux.Handle("PUT /api/suppliers/{id}", authMW(http.HandlerFunc(server.HandleSupplierByID)))
	mux.Handle("DELETE /api/suppliers/{id}", authMW(http.HandlerFunc(server.HandleSupplierByID)))
	mux.Handle("GET /api/purchase-orders", authMW(http.HandlerFunc(server.HandlePurchaseOrders)))
	mux.Handle("POST /api/purchase-orders", authMW(http.HandlerFunc(server.HandlePurchaseOrders)))
	mux.Handle("GET /api/purchase-orders/{id}", authMW(http.HandlerFunc(server.HandlePurchaseOrderByID)))
	mux.Handle("PUT /api/purchase-orders/{id}", authMW(http.HandlerFunc(server.HandlePurchaseOrderByID)))
	mux.Handle("POST /api/purchase-orders/{id}/emit", authMW(http.HandlerFunc(server.HandlePurchaseOrderEmit)))
	mux.Handle("POST /api/purchase-orders/{id}/cancel", authMW(http.HandlerFunc(server.HandlePurchaseOrderCancel)))
	mux.Handle("POST /api/purchase-orders/{id}/receive", authMW(http.HandlerFunc(server.HandlePurchaseOrderReceive)))

	// Project gallery photos (CRM Phase 1) & Commercial Showcase (CRM Phase 4)
	mux.Handle("GET /api/projects/{id}/photos", authMW(http.HandlerFunc(server.HandleProjectPhotos)))
	mux.Handle("POST /api/projects/{id}/photos", authMW(http.HandlerFunc(server.HandleProjectPhotos)))
	mux.Handle("PATCH /api/projects/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleProjectPhotoByID)))
	mux.Handle("DELETE /api/projects/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleProjectPhotoByID)))
	mux.Handle("GET /api/showcase/photos", authMW(http.HandlerFunc(server.HandleShowcasePhotos)))

	// Project internal messages & technical workflow (CRM Phase 2)
	mux.Handle("GET /api/projects/{id}/messages", authMW(http.HandlerFunc(server.HandleProjectInternalMessages)))
	mux.Handle("POST /api/projects/{id}/messages", authMW(http.HandlerFunc(server.HandleProjectInternalMessages)))
	mux.Handle("PATCH /api/projects/{id}/technical-workflow", authMW(http.HandlerFunc(server.HandleProjectTechnicalWorkflow)))

	// Warranty tickets (CRM Phase 3)
	mux.Handle("GET /api/warranties", authMW(http.HandlerFunc(server.HandleWarrantyTickets)))
	mux.Handle("POST /api/warranties", authMW(http.HandlerFunc(server.HandleWarrantyTickets)))
	mux.Handle("GET /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("PATCH /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("DELETE /api/warranties/{id}", authMW(http.HandlerFunc(server.HandleWarrantyTicketByID)))
	mux.Handle("GET /api/warranties/{id}/photos", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotos)))
	mux.Handle("POST /api/warranties/{id}/photos", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotos)))
	mux.Handle("DELETE /api/warranties/{id}/photos/{photoId}", authMW(http.HandlerFunc(server.HandleWarrantyTicketPhotoDelete)))
}
