// 責務: 設定の動作検証の単体テスト用のデータ（本番コードからは使わない）。

// 実機（nft 1.0.9）で、ruleset.tsの出力を適用した後の`nft list table inet vpngwgui`の出力（抜粋）。
export const SAMPLE_LISTING = `table inet vpngwgui {
	set bypass4 {
		type ipv4_addr
		flags timeout
		elements = { 203.0.113.5 timeout 5m expires 4m59s982ms }
	}

	chain postrouting {
		type nat hook postrouting priority srcnat; policy accept;
		meta mark 0x00000100 oifname "eth0" masquerade
		oifname "tun0" masquerade
	}

	chain forward {
		type filter hook forward priority filter; policy accept;
		ct status dnat accept
		oifname != "eth0" ct direction reply ct state established,related accept
		ct mark 0x00000100 accept
		iifname "eth0" oifname "tun0" accept
		iifname "tun0" oifname "eth0" ct state established,related accept
		iifname "tun0" drop
		iifname "eth0" drop
	}

	chain bypass_mark {
		type filter hook prerouting priority mangle; policy accept;
		iifname "eth0" ip daddr @bypass4 meta mark set 0x00000100 ct mark set 0x00000100
	}

	chain dns_redirect {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "eth0" meta l4proto { tcp, udp } th dport 53 ip daddr != { 192.168.3.240, 192.168.3.5 } update @redirected4 { ip saddr timeout 10m } dnat ip to 192.168.3.240:53
	}
}
`;
