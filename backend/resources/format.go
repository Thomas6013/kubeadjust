package resources

import "fmt"

// FmtBytes formats a byte count as a human-readable string (Gi/Mi/Ki/B).
func FmtBytes(b int64) string {
	const gib = 1024 * 1024 * 1024
	const mib = 1024 * 1024
	const kib = 1024
	switch {
	case b >= gib:
		return fmt.Sprintf("%.2f Gi", float64(b)/float64(gib))
	case b >= mib:
		return fmt.Sprintf("%d Mi", b/mib)
	case b >= kib:
		return fmt.Sprintf("%d Ki", b/kib)
	default:
		return fmt.Sprintf("%d B", b)
	}
}

// FmtMillicores formats a millicores value as "500m" or "1.50" (cores).
func FmtMillicores(m int64) string {
	if m >= 1000 {
		return fmt.Sprintf("%.2f", float64(m)/1000)
	}
	return fmt.Sprintf("%dm", m)
}
