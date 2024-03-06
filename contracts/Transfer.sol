// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import { ItemType } from "./Structs.sol";

contract Transfer {

    function transferCurrency(
        address currency,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (from == to) return;
        if (amount == 0) return;

        if (from == address(this)) IERC20(currency).transfer(to, amount);
        else IERC20(currency).transferFrom(from, to, amount);
    }

    function transferToken(
        ItemType itemType,
        address collection, 
        address from,
        address to, 
        uint256 tokenId,
        uint256 amount
    ) internal {
        if (itemType == ItemType.ERC721) {
            // Handle ERC-721 transfer
            IERC721(collection).transferFrom(from, to, tokenId);
        } else if (itemType == ItemType.ERC1155) {
            // Handle ERC-1155 transfer
            IERC1155(collection).safeTransferFrom(from, to, tokenId, amount, "");
        } else {
            // Handle other cases or throw an error
            revert("Unsupported token type");
        }
    }
}
