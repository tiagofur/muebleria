package storage

import "testing"

func TestIsValidUUID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{
			name:  "valid lowercase v4 UUID",
			input: "123e4567-e89b-12d3-a456-426614174000",
			want:  true,
		},
		{
			name:  "valid uppercase v4 UUID",
			input: "123E4567-E89B-12D3-A456-426614174000",
			want:  true,
		},
		{
			name:  "too short",
			input: "123e4567-e89b-12d3-a456-42661417400",
			want:  false,
		},
		{
			name:  "too long",
			input: "123e4567-e89b-12d3-a456-4266141740000",
			want:  false,
		},
		{
			name:  "missing hyphen",
			input: "123e4567e89b-12d3-a456-426614174000",
			want:  false,
		},
		{
			name:  "invalid non-hex character",
			input: "123e4567-e89b-12d3-a456-42661417400g",
			want:  false,
		},
		{
			name:  "invalid symbol",
			input: "123e4567-e89b-12d3-a456-42661417400!",
			want:  false,
		},
		{
			name:  "empty string",
			input: "",
			want:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidUUID(tt.input)
			if got != tt.want {
				t.Errorf("isValidUUID(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
