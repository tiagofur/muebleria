package domain

type TeamCapability string

const (
	TeamCapabilityView             TeamCapability = "team:view"
	TeamCapabilityInviteSales      TeamCapability = "team:invite:sales"
	TeamCapabilityInviteProduction TeamCapability = "team:invite:production"
	TeamCapabilityManageSales      TeamCapability = "team:manage:sales"
	TeamCapabilityManageProduction TeamCapability = "team:manage:production"
	TeamCapabilityManageAll        TeamCapability = "team:manage:all"
	TeamCapabilityAssignAdmin      TeamCapability = "team:assign:admin"
	TeamCapabilityTransferAdmin    TeamCapability = "team:transfer_admin"
	TeamCapabilityManageSectors    TeamCapability = "team:manage:sectors"
	TeamCapabilityRevokeSessions   TeamCapability = "team:revoke_sessions"
)

var teamCapabilityOrder = []TeamCapability{
	TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityInviteProduction,
	TeamCapabilityManageSales, TeamCapabilityManageProduction, TeamCapabilityManageAll,
	TeamCapabilityAssignAdmin, TeamCapabilityTransferAdmin, TeamCapabilityManageSectors,
	TeamCapabilityRevokeSessions,
}

var teamCapabilitiesByOrganizationType = map[OrganizationType]map[UserRole][]TeamCapability{
	OrganizationTypeFactory: {
		RoleAdmin:             teamCapabilityOrder,
		RoleGerenteVentas:     {TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityManageSales},
		RoleGerenteProduccion: {TeamCapabilityView, TeamCapabilityInviteProduction, TeamCapabilityManageProduction, TeamCapabilityManageSectors},
	},
	OrganizationTypeStore: {
		RoleAdmin:         {TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityManageSales, TeamCapabilityManageAll, TeamCapabilityAssignAdmin, TeamCapabilityTransferAdmin, TeamCapabilityRevokeSessions},
		RoleGerenteVentas: {TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityManageSales},
	},
	OrganizationTypeDealer: {
		RoleAdmin:         {TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityManageSales, TeamCapabilityManageAll, TeamCapabilityAssignAdmin, TeamCapabilityTransferAdmin, TeamCapabilityRevokeSessions},
		RoleGerenteVentas: {TeamCapabilityView, TeamCapabilityInviteSales, TeamCapabilityManageSales},
	},
}

func TeamCapabilitiesForRoles(roles []UserRole, organizationType OrganizationType) []TeamCapability {
	policy := teamCapabilitiesByOrganizationType[organizationType]
	granted := make(map[TeamCapability]struct{})
	for _, role := range roles {
		for _, capability := range policy[role] {
			granted[capability] = struct{}{}
		}
	}
	out := make([]TeamCapability, 0, len(granted))
	for _, capability := range teamCapabilityOrder {
		if _, ok := granted[capability]; ok {
			out = append(out, capability)
		}
	}
	return out
}

func HasTeamCapability(roles []UserRole, organizationType OrganizationType, wanted TeamCapability) bool {
	for _, capability := range TeamCapabilitiesForRoles(roles, organizationType) {
		if capability == wanted {
			return true
		}
	}
	return false
}
