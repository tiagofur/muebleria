package main

import "testing"

func TestServerListenAddress(t *testing.T) {
	for _, tc := range []struct {
		name, isolated, host, want string
		wantError                  bool
	}{
		{name: "ordinary server keeps its existing bind", want: ":8080"},
		{name: "ordinary server ignores gate-only host", host: "127.0.0.1", want: ":8080"},
		{name: "isolated gate binds loopback", isolated: "1", host: "127.0.0.1", want: "127.0.0.1:8080"},
		{name: "isolated gate rejects missing host", isolated: "1", wantError: true},
		{name: "isolated gate rejects wildcard", isolated: "1", host: "0.0.0.0", wantError: true},
		{name: "isolated gate rejects hostname", isolated: "1", host: "localhost", wantError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := serverListenAddress("8080", tc.isolated, tc.host)
			if (err != nil) != tc.wantError || got != tc.want {
				t.Fatalf("serverListenAddress() = %q, %v; want %q, error=%t", got, err, tc.want, tc.wantError)
			}
		})
	}
}
