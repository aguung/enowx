package proxypool

import "testing"

func TestParse(t *testing.T) {
	cases := []struct {
		in     string
		want   Proxy
		wantOK bool
	}{
		// URL scheme forms
		{"http://1.2.3.4:8080", Proxy{"http", "1.2.3.4", 8080, "", ""}, true},
		{"https://host.com:3128", Proxy{"https", "host.com", 3128, "", ""}, true},
		{"socks5://user:pass@10.0.0.1:1080", Proxy{"socks5", "10.0.0.1", 1080, "user", "pass"}, true},
		{"socks5h://h:9050", Proxy{"socks5h", "h", 9050, "", ""}, true},
		// colon-delimited vendor forms
		{"1.2.3.4:8080", Proxy{"http", "1.2.3.4", 8080, "", ""}, true},
		{"host.com:3128:bob:secret", Proxy{"http", "host.com", 3128, "bob", "secret"}, true},
		// user:pass@host:port
		{"bob:secret@1.2.3.4:8080", Proxy{"http", "1.2.3.4", 8080, "bob", "secret"}, true},
		// whitespace tolerated
		{"  1.2.3.4:8080  ", Proxy{"http", "1.2.3.4", 8080, "", ""}, true},
		// invalid
		{"", Proxy{}, false},
		{"ftp://x:1", Proxy{}, false},
		{"host:notaport", Proxy{}, false},
		{"host:99999", Proxy{}, false},
		{"justhost", Proxy{}, false},
		{"a:b:c", Proxy{}, false}, // 3 parts, ambiguous
	}
	for _, c := range cases {
		got, err := Parse(c.in)
		if c.wantOK && err != nil {
			t.Errorf("Parse(%q) unexpected error: %v", c.in, err)
			continue
		}
		if !c.wantOK {
			if err == nil {
				t.Errorf("Parse(%q) expected error, got %+v", c.in, got)
			}
			continue
		}
		if got != c.want {
			t.Errorf("Parse(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestURL(t *testing.T) {
	if u := (Proxy{"socks5", "h", 1080, "u", "p"}).URL(); u != "socks5://u:p@h:1080" {
		t.Errorf("URL() = %q", u)
	}
	if u := (Proxy{"http", "1.2.3.4", 80, "", ""}).URL(); u != "http://1.2.3.4:80" {
		t.Errorf("URL() = %q", u)
	}
}

func TestParseBulk(t *testing.T) {
	text := "1.2.3.4:8080\nsocks5://h:1080\ngarbage\nhost:3128:u:p"
	ok, bad := ParseBulk(text)
	if len(ok) != 3 {
		t.Errorf("want 3 ok, got %d (%+v)", len(ok), ok)
	}
	if len(bad) != 1 {
		t.Errorf("want 1 bad, got %d (%+v)", len(bad), bad)
	}
}
