// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

library Transfer {

    function transferCurrency(
        address currency,
        address from,
        address to,
        uint256 amount
    ) external {
        if (from == to) return;
        if (amount == 0) return;

        if (from == address(this)) IERC20(currency).transfer(to, amount);
        else IERC20(currency).transferFrom(from, to, amount);
    }

    function transferToken(
        address collection, 
        address from,
        address to, 
        uint256 tokenId,
        uint256 amount
    ) external {
        if (isERC721(collection)) {
            // Handle ERC-721 transfer
            IERC721(collection).transferFrom(from, to, tokenId);
        } else if (isERC1155(collection)) {
            // Handle ERC-1155 transfer
            IERC1155(collection).safeTransferFrom(from, to, tokenId, amount, "");
        } else {
            // Handle other cases or throw an error
            revert("Unsupported token type");
        }
    }

    function isERC721(address tokenAddress) internal view returns (bool) {
        try IERC721(tokenAddress).supportsInterface(0x80ac58cd) returns (bool supported) {
            return supported;
        } catch {
            return false;
        }
    }

    function isERC1155(address tokenAddress) internal view returns (bool) {
        try IERC1155(tokenAddress).supportsInterface(0xd9b67a26) returns (bool supported) {
            return supported;
        } catch {
            return false;
        }
    }
}
